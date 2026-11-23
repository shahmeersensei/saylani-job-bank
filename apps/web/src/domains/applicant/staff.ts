import 'server-only';
import { schema } from '@jobbank/db';
import {
  APPLICANT_STATUSES,
  IDENTITY_STATUSES,
  ROLE_LABELS,
  ROLES,
  type ApplicantStatus,
  type CounterRegisterInput,
  type IdentityMethod,
  type IdentityOutcome,
  type IdentityStatus,
  type IdentityVerificationInput,
  type Role,
  type StaffApplicantProfileUpdateInput,
  type StaffRegisterApplicantInput,
  type UpdatePersonalInput,
} from '@jobbank/shared';
import type { assistedApplicantRegistrationSchema } from '@jobbank/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { isPlaceholderEmail, issueOtp, placeholderEmailFor, verifyOtpCode } from '@/domains/auth';
import { getBranchContact, type BranchContact } from '@/domains/branch';
import { assertActiveMasterData, masterDataLabels } from '@/domains/settings';
import { recordAudit, runCommand } from '@/domains/shared/audit';
import { enforceRateLimit } from '@/domains/shared/rate-limit';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  ScopeViolationError,
  ValidationError,
} from '@/domains/shared/errors';
import { maskCnic, maskPhone } from '@/domains/shared/masking';
import { paginationMeta, type ListQuery } from '@/domains/shared/pagination';
import { likeContains, multiCode, multiEnum, multiUuid } from '@/domains/shared/filters';
import {
  assertCityAccess,
  assertBranchAccess,
  assertPermission,
  assertRole,
  cityScope as branchCityScope,
  hasPermission,
  isSuperAdmin,
  type Actor,
} from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { isSupportedPkMobile, normalizePkMobile } from '@/lib/format/phone';
import { toGeography } from '@/lib/geospatial';
import { applicantMachine } from './machine';
import { assertEmailFree, cnicTakenError, IDENTITY_FIELDS } from './profile';
import {
  a,
  addr,
  buildProfile,
  cert,
  cnicOwner,
  currentDocuments,
  completenessFor,
  docs,
  edu,
  exp,
  idv,
  loadApplicant,
  lng,
  permAddr,
  pref,
  refreshProfileState,
  skl,
  type ApplicantProfile,
  type ApplicantRow,
  type SignedIn,
} from './repository';
import { withRegistrationReference } from './registration-reference';
import { completeTokenForRegistration } from './tokens';
import type { DbExecutor } from '@/lib/db';

/** City must be active master data; an area must belong to that city. */
async function assertCityArea(
  executor: DbExecutor,
  address: { cityCode: string; areaCode: string | null },
  path: string,
): Promise<void> {
  const city = (
    await assertActiveMasterData(executor, 'CITY', [address.cityCode], () => `${path}.cityCode`)
  ).get(address.cityCode)!;
  if (address.areaCode) {
    const area = (
      await assertActiveMasterData(executor, 'AREA', [address.areaCode], () => `${path}.areaCode`)
    ).get(address.areaCode)!;
    if (area.parentId !== city.id) {
      throw new ValidationError([
        { path: `${path}.areaCode`, message: `This area is not in ${city.label}` },
      ]);
    }
  }
}

// ─── Counter registration ──────────────────────────────────────────────

/**
 * Staff register someone with no smartphone or email at a counter. The account has no
 * password, so nobody can sign in to it; staff keep the profile up to date for them.
 * Ported from Najam (2026-11-11), adapted to this repo's rules:
 * - No email is accepted at all (the schema has no email field): the users row gets a
 *   placeholder email under the repo's own placeholder domain, and the applicant row
 *   stores email null. A walk-in's real email must never be stored unverified.
 * - The phone is NOT allowed to be shared with another account. This repo signs
 *   applicants in by phone OTP and the OTP lookup takes the first row for a number,
 *   so a shared number would sign the wrong person in. A taken phone is a 409
 *   PHONE_TAKEN; the phone is optional, so staff leave it blank when the candidate
 *   has no number of their own. (Najam dropped the phone unique constraint because
 *   that repo dropped OTP entirely — not portable here.)
 * - Consent is evidence, not a checkbox alone: consentConfirmedAt is set only
 *   because the schema requires consentConfirmed=true, which staff tick after the
 *   candidate signs the paper consent form kept at the branch. The audit row
 *   records it; there is no separate consent-reference column yet (open decision).
 * - Applicants are ACTIVE from creation (no DRAFT in this repo). registrationSource
 *   is STAFF_ASSISTED — there is no COUNTER value in the enum; counterRegisteredBy
 *   is what marks a counter registration.
 * - branchId, when supplied, must be one of the actor's branches and active;
 *   otherwise the actor's active branch (Super Admin switcher) or their single
 *   branch is used. The token flow is untouched: this is a separate path for
 *   walk-ins without smartphones, and it creates no token.
 */
export async function registerApplicantAtCounter(
  ctx: SignedIn,
  input: CounterRegisterInput,
): Promise<{ id: string }> {
  assertPermission(ctx.actor, 'applicant:manage');
  let phoneNumber: string | null = null;
  if (input.phone) {
    phoneNumber = normalizePkMobile(input.phone);
    if (!phoneNumber || !isSupportedPkMobile(phoneNumber)) {
      throw new ValidationError([
        { path: 'phone', message: 'Enter a valid Pakistani mobile number' },
      ]);
    }
  }
  const { phone: _phone, consentConfirmed: _consent, branchId: inputBranchId, ...personal } = input;

  try {
    return await runCommand(ctx, async (cmd) => {
      const { tx, audit } = cmd;
      let branchId = inputBranchId ?? null;
      if (branchId) {
        const [branch] = await tx
          .select({ id: schema.branches.id, isActive: schema.branches.isActive })
          .from(schema.branches)
          .where(eq(schema.branches.id, branchId));
        if (!branch || !branch.isActive) {
          throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
        }
        assertBranchAccess(ctx.actor, branch.id, {
          entityType: 'branch',
          entityId: branch.id,
        });
      } else {
        branchId =
          ctx.actor.activeBranchId ??
          (ctx.actor.branchIds.length === 1 ? ctx.actor.branchIds[0]! : null);
      }
      if (!branchId) {
        throw new ValidationError([{ path: 'branchId', message: 'Choose a branch first' }]);
      }
      if (phoneNumber) {
        const [phoneOwner] = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.phoneNumber, phoneNumber));
        if (phoneOwner) {
          throw new ConflictError(
            'This mobile number already has an account. Register without a phone number — the candidate checks in at the branch.',
            { reason: 'PHONE_TAKEN' },
          );
        }
      }
      const owner = await cnicOwner(tx, input.cnic);
      if (owner) throw await cnicTakenError(tx, owner);
      const [user] = await tx
        .insert(schema.users)
        .values({
          name: input.fullName,
          email: phoneNumber
            ? placeholderEmailFor(phoneNumber)
            : `${crypto.randomUUID()}@${schema.PLACEHOLDER_EMAIL_DOMAIN}`,
          phoneNumber,
          status: 'ACTIVE',
        })
        .returning({ id: schema.users.id });
      await tx.insert(schema.userRoles).values({ userId: user!.id, roleCode: 'APPLICANT' });
      const [row] = await withRegistrationReference(tx, {}, (registrationReference) =>
        tx
          .insert(a)
          .values({
            ...personal,
            email: null,
            userId: user!.id,
            branchId,
            status: 'ACTIVE',
            registrationSource: 'STAFF_ASSISTED',
            registrationReference,
            registeredBy: ctx.actor.userId,
            counterRegisteredBy: ctx.actor.userId,
            consentConfirmedAt: new Date(),
          })
          .returning({ id: a.id }),
      );
      audit({
        action: 'applicant.counter_register',
        entityType: 'applicant',
        entityId: row!.id,
        branchId,
        after: personal,
        metadata: { consentConfirmed: true },
      });
      await refreshProfileState(cmd, row!.id);
      return { id: row!.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'applicants_cnic_unique')) {
      const owner = await cnicOwner(db, input.cnic);
      if (owner) throw await cnicTakenError(db, owner);
    }
    // Audit 2026-11-11 (L-21): a concurrent phone collision races the
    // in-transaction phone check — the users insert hits the phone unique
    // index (or the phone-derived placeholder email's). Map it to the same
    // specific PHONE_TAKEN message instead of a generic 409.
    if (
      phoneNumber &&
      (isUniqueViolation(error, 'users_phoneNumber_unique') ||
        isUniqueViolation(error, 'users_email_unique'))
    ) {
      throw new ConflictError(
        'This mobile number already has an account. Register without a phone number — the candidate checks in at the branch.',
        { reason: 'PHONE_TAKEN' },
      );
    }
    throw error;
  }
}

// ─── Search ────────────────────────────────────────────────────────────

export const APPLICANT_SORTABLE = ['fullName', 'createdAt', 'profileCompleteness'] as const;

/** YYYY-MM-DD; validated by parseListQuery, range checked in listApplicants. */
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-07')
  .optional();

export const applicantFilters = {
  /** Multi-select (Daraz/OLX-style checkboxes): one repeated key per ticked box. */
  status: multiEnum(APPLICANT_STATUSES),
  identityStatus: multiEnum(IDENTITY_STATUSES),
  branchId: multiUuid,
  cityCode: multiCode,
  areaCode: multiCode,
  skillCode: multiCode,
  /** Registration date range (inclusive, Pakistan day boundaries — M1). */
  createdFrom: dateOnlySchema,
  createdTo: dateOnlySchema,
};

/** Start of a YYYY-MM-DD day in Pakistan time, as a Date. */
const pktDayStart = (day: string): Date => new Date(`${day}T00:00:00.000+05:00`);

/** The calendar day after a YYYY-MM-DD date. */
const nextDay = (day: string): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export async function registerApplicantForStaff(
  ctx: SignedIn,
  input: z.infer<typeof assistedApplicantRegistrationSchema>,
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:create');
  const phone = normalizePkMobile(input.phone);
  if (!phone || !isSupportedPkMobile(phone)) {
    throw new ValidationError([{ path: 'phone', message: 'Enter a Pakistani mobile number' }]);
  }
  let applicantId: string;
  try {
    await runCommand(ctx, async (cmd) => {
      const { tx, audit } = cmd;
      const [branch] = await tx
        .select({ id: schema.branches.id, isActive: schema.branches.isActive })
        .from(schema.branches)
        .where(eq(schema.branches.id, input.branchId));
      if (!branch || !branch.isActive) {
        throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
      }
      assertBranchAccess(ctx.actor, branch.id, {
        entityType: 'branch',
        entityId: branch.id,
      });

      const [phoneOwner] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phoneNumber, phone));
      if (phoneOwner) {
        throw new ConflictError(
          'This mobile number already has an account. Use the existing account recovery process.',
          { reason: 'PHONE_TAKEN' },
        );
      }
      const existingCnic = await cnicOwner(tx, input.cnic);
      if (existingCnic) throw await cnicTakenError(tx, existingCnic);

      const email = input.email ?? placeholderEmailFor(phone);
      const [emailOwner] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email));
      if (emailOwner) {
        throw new ConflictError('This email address is already associated with an account.', {
          reason: 'EMAIL_TAKEN',
        });
      }

      const [user] = await tx
        .insert(schema.users)
        .values({
          name: input.fullName,
          email,
          phoneNumber: phone,
          phoneNumberVerified: false,
          emailVerified: Boolean(input.email),
          status: 'ACTIVE',
        })
        .returning({ id: schema.users.id });
      await tx.insert(schema.userRoles).values({
        userId: user!.id,
        roleCode: 'APPLICANT',
        branchId: null,
        grantedBy: ctx.actor.userId,
      });

      const [row] = await withRegistrationReference(tx, {}, (registrationReference) =>
        tx
          .insert(a)
          .values({
            userId: user!.id,
            branchId: branch.id,
            registrationSource: 'STAFF_ASSISTED',
            registrationReference,
            registeredBy: ctx.actor.userId,
            contactConfirmedBy: ctx.actor.userId,
            contactConfirmedAt: new Date(),
            fullName: input.fullName,
            fatherName: input.fatherName,
            cnic: input.cnic,
            dateOfBirth: input.dateOfBirth,
            gender: input.gender,
            email: input.email ?? null,
          })
          .returning({ id: a.id }),
      );
      applicantId = row!.id;

      // Audit 2026-11-11 (L-23): the city must be active and the area must
      // belong to it — same check staffRegisterApplicant already runs.
      await assertCityArea(tx, input.address, 'address');
      await tx.insert(addr).values({
        applicantId: applicantId,
        addressLine: input.address.addressLine ?? '',
        cityCode: input.address.cityCode,
        areaCode: input.address.areaCode ?? null,
        // Home location pin is optional (2026-11-16): the staff form no
        // longer collects one, so a new registration stores null.
        location: input.address.location ? toGeography(input.address.location) : null,
      });
      await assertActiveMasterData(
        tx,
        'EDUCATION_LEVEL',
        input.education.items.map((item) => item.levelCode),
        (i) => `education.items.${i}.levelCode`,
      );
      if (input.education.items.length > 0) {
        await tx.insert(schema.applicantEducation).values(
          input.education.items.map((item, sortOrder) => ({
            ...item,
            applicantId,
            sortOrder,
          })),
        );
      }
      const categorizedExperience = input.experience.items.flatMap((item, i) =>
        item.categoryCode ? [{ code: item.categoryCode, i }] : [],
      );
      await assertActiveMasterData(
        tx,
        'JOB_CATEGORY',
        categorizedExperience.map((item) => item.code),
        (i) => `experience.items.${categorizedExperience[i]!.i}.categoryCode`,
      );
      if (input.experience.items.length > 0) {
        await tx.insert(schema.applicantExperience).values(
          input.experience.items.map((item, sortOrder) => ({
            ...item,
            applicantId,
            sortOrder,
            startMonth: `${item.startMonth}-01`,
            endMonth: item.endMonth ? `${item.endMonth}-01` : null,
          })),
        );
      }
      await tx
        .update(a)
        .set({ hasNoExperience: input.experience.hasNoExperience })
        .where(eq(a.id, applicantId));
      await assertActiveMasterData(
        tx,
        'SKILL',
        input.skills.items.map((item) => item.skillCode),
        (i) => `skills.items.${i}.skillCode`,
      );
      if (input.skills.items.length > 0) {
        await tx
          .insert(schema.applicantSkills)
          .values(input.skills.items.map((item) => ({ ...item, applicantId })));
      }
      await assertActiveMasterData(
        tx,
        'LANGUAGE',
        input.languages.items.map((item) => item.languageCode),
        (i) => `languages.items.${i}.languageCode`,
      );
      if (input.languages.items.length > 0) {
        await tx
          .insert(schema.applicantLanguages)
          .values(input.languages.items.map((item) => ({ ...item, applicantId })));
      }
      if (input.certifications.items.length > 0) {
        await tx.insert(schema.applicantCertifications).values(
          input.certifications.items.map((item, sortOrder) => ({
            ...item,
            applicantId,
            sortOrder,
            issuedMonth: item.issuedMonth ? `${item.issuedMonth}-01` : null,
            expiresMonth: item.expiresMonth ? `${item.expiresMonth}-01` : null,
          })),
        );
      }
      if (input.preferences) {
        await assertActiveMasterData(
          tx,
          'JOB_CATEGORY',
          input.preferences.categoryCodes,
          (i) => `preferences.categoryCodes.${i}`,
        );
        await tx.insert(schema.applicantPreferences).values({
          applicantId,
          ...input.preferences,
        });
      }
      await refreshProfileState(cmd, applicantId);
      audit({
        action: 'applicant.register_staff_assisted',
        entityType: 'applicant',
        entityId: applicantId,
        branchId: branch.id,
        after: {
          registrationSource: 'STAFF_ASSISTED',
          registeredBy: ctx.actor.userId,
          contactConfirmed: true,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_phoneNumber_unique')) {
      throw new ConflictError(
        'This mobile number already has an account. Use the existing account recovery process.',
        { reason: 'PHONE_TAKEN' },
      );
    }
    if (isUniqueViolation(error, 'applicants_cnic_unique')) {
      throw new ConflictError('This CNIC is already registered.', { reason: 'CNIC_TAKEN' });
    }
    if (isUniqueViolation(error, 'users_email_unique')) {
      throw new ConflictError('This email address is already associated with an account.', {
        reason: 'EMAIL_TAKEN',
      });
    }
    throw error;
  }
  return getApplicantForStaff(ctx.actor, applicantId!);
}

/** Update an existing applicant profile without changing its account or branch assignment. */
export async function staffUpdateApplicantProfile(
  ctx: SignedIn,
  applicantId: string,
  input: StaffApplicantProfileUpdateInput,
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:manage');
  await scopedApplicant(ctx.actor, applicantId);

  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      const row = await loadApplicant(tx, applicantId, { forUpdate: true });
      assertBranchAccess(ctx.actor, row.branchId, {
        entityType: 'applicant',
        entityId: row.id,
      });

      const existingCnic = await cnicOwner(tx, input.cnic, row.id);
      if (existingCnic) {
        throw new ConflictError('Another applicant already has this CNIC');
      }

      const experienceCategories = input.experience.items.flatMap((item, index) =>
        item.categoryCode ? [{ code: item.categoryCode, index }] : [],
      );
      await assertActiveMasterData(
        tx,
        'EDUCATION_LEVEL',
        input.education.items.map((item) => item.levelCode),
        (index) => `education.items.${index}.levelCode`,
      );
      await assertActiveMasterData(
        tx,
        'JOB_CATEGORY',
        [
          ...experienceCategories.map((item) => item.code),
          ...(input.preferences?.categoryCodes ?? []),
        ],
        (index) =>
          index < experienceCategories.length
            ? `experience.items.${experienceCategories[index]!.index}.categoryCode`
            : `preferences.categoryCodes.${index - experienceCategories.length}`,
      );
      await assertActiveMasterData(
        tx,
        'SKILL',
        input.skills.items.map((item) => item.skillCode),
        (index) => `skills.items.${index}.skillCode`,
      );
      await assertActiveMasterData(
        tx,
        'LANGUAGE',
        input.languages.items.map((item) => item.languageCode),
        (index) => `languages.items.${index}.languageCode`,
      );

      const identityChanged = IDENTITY_FIELDS.some(
        (field) => input[field] !== row[field as keyof ApplicantRow],
      );
      await tx
        .update(a)
        .set({
          fullName: input.fullName,
          fatherName: input.fatherName,
          cnic: input.cnic,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          email: input.email ?? null,
          hasNoExperience: input.experience.hasNoExperience,
          identityStatus: identityChanged ? 'UNVERIFIED' : row.identityStatus,
        })
        .where(eq(a.id, row.id));

      if (input.fullName !== row.fullName) {
        await tx
          .update(schema.users)
          .set({ name: input.fullName })
          .where(eq(schema.users.id, row.userId));
      }

      // Audit 2026-11-11 (L-23): the city must be active and the area must
      // belong to it — same check staffRegisterApplicant already runs.
      await assertCityArea(tx, input.address, 'address');
      await tx
        .insert(addr)
        .values({
          applicantId: row.id,
          addressLine: input.address.addressLine ?? '',
          cityCode: input.address.cityCode,
          areaCode: input.address.areaCode ?? null,
          // Home location pin is optional (2026-11-16): a null location on
          // an update leaves a stored pin alone instead of wiping it —
          // the staff form no longer sends one at all.
          location: input.address.location ? toGeography(input.address.location) : null,
        })
        .onConflictDoUpdate({
          target: addr.applicantId,
          set: {
            addressLine: input.address.addressLine ?? '',
            cityCode: input.address.cityCode,
            areaCode: input.address.areaCode ?? null,
            ...(input.address.location ? { location: toGeography(input.address.location) } : {}),
            updatedAt: new Date(),
          },
        });

      const educationRows = await tx
        .select({ id: schema.applicantEducation.id })
        .from(schema.applicantEducation)
        .where(eq(schema.applicantEducation.applicantId, row.id));
      const educationIds = new Set(educationRows.map((item) => item.id));
      const retainedEducationIds = new Set<string>();
      for (const [index, item] of input.education.items.entries()) {
        const id = input.recordIds.education[index] ?? null;
        if (id) {
          if (!educationIds.has(id)) {
            throw new ValidationError([
              {
                path: `recordIds.education.${index}`,
                message: 'Refresh the profile and try again',
              },
            ]);
          }
          retainedEducationIds.add(id);
          await tx
            .update(schema.applicantEducation)
            .set({ ...item, sortOrder: index })
            .where(
              and(
                eq(schema.applicantEducation.id, id),
                eq(schema.applicantEducation.applicantId, row.id),
              ),
            );
        } else {
          await tx.insert(schema.applicantEducation).values({
            ...item,
            applicantId: row.id,
            sortOrder: index,
          });
        }
      }
      const removedEducationIds = [...educationIds].filter((id) => !retainedEducationIds.has(id));
      if (removedEducationIds.length) {
        await tx
          .delete(schema.applicantEducation)
          .where(
            and(
              eq(schema.applicantEducation.applicantId, row.id),
              inArray(schema.applicantEducation.id, removedEducationIds),
            ),
          );
      }

      const experienceRows = await tx
        .select({ id: schema.applicantExperience.id })
        .from(schema.applicantExperience)
        .where(eq(schema.applicantExperience.applicantId, row.id));
      const experienceIds = new Set(experienceRows.map((item) => item.id));
      const retainedExperienceIds = new Set<string>();
      for (const [index, item] of input.experience.items.entries()) {
        const id = input.recordIds.experience[index] ?? null;
        const values = {
          ...item,
          startMonth: `${item.startMonth}-01`,
          endMonth: item.endMonth ? `${item.endMonth}-01` : null,
          sortOrder: index,
        };
        if (id) {
          if (!experienceIds.has(id)) {
            throw new ValidationError([
              {
                path: `recordIds.experience.${index}`,
                message: 'Refresh the profile and try again',
              },
            ]);
          }
          retainedExperienceIds.add(id);
          await tx
            .update(schema.applicantExperience)
            .set(values)
            .where(
              and(
                eq(schema.applicantExperience.id, id),
                eq(schema.applicantExperience.applicantId, row.id),
              ),
            );
        } else {
          await tx.insert(schema.applicantExperience).values({ ...values, applicantId: row.id });
        }
      }
      const removedExperienceIds = [...experienceIds].filter(
        (id) => !retainedExperienceIds.has(id),
      );
      if (removedExperienceIds.length) {
        await tx
          .delete(schema.applicantExperience)
          .where(
            and(
              eq(schema.applicantExperience.applicantId, row.id),
              inArray(schema.applicantExperience.id, removedExperienceIds),
            ),
          );
      }

      await tx.delete(schema.applicantSkills).where(eq(schema.applicantSkills.applicantId, row.id));
      if (input.skills.items.length) {
        await tx
          .insert(schema.applicantSkills)
          .values(input.skills.items.map((item) => ({ ...item, applicantId: row.id })));
      }
      await tx
        .delete(schema.applicantLanguages)
        .where(eq(schema.applicantLanguages.applicantId, row.id));
      if (input.languages.items.length) {
        await tx
          .insert(schema.applicantLanguages)
          .values(input.languages.items.map((item) => ({ ...item, applicantId: row.id })));
      }

      const certificationRows = await tx
        .select({ id: schema.applicantCertifications.id })
        .from(schema.applicantCertifications)
        .where(eq(schema.applicantCertifications.applicantId, row.id));
      const certificationIds = new Set(certificationRows.map((item) => item.id));
      const retainedCertificationIds = new Set<string>();
      for (const [index, item] of input.certifications.items.entries()) {
        const id = input.recordIds.certifications[index] ?? null;
        const values = {
          ...item,
          issuedMonth: item.issuedMonth ? `${item.issuedMonth}-01` : null,
          expiresMonth: item.expiresMonth ? `${item.expiresMonth}-01` : null,
          sortOrder: index,
        };
        if (id) {
          if (!certificationIds.has(id)) {
            throw new ValidationError([
              {
                path: `recordIds.certifications.${index}`,
                message: 'Refresh the profile and try again',
              },
            ]);
          }
          retainedCertificationIds.add(id);
          await tx
            .update(schema.applicantCertifications)
            .set(values)
            .where(
              and(
                eq(schema.applicantCertifications.id, id),
                eq(schema.applicantCertifications.applicantId, row.id),
              ),
            );
        } else {
          await tx
            .insert(schema.applicantCertifications)
            .values({ ...values, applicantId: row.id });
        }
      }
      const removedCertificationIds = [...certificationIds].filter(
        (id) => !retainedCertificationIds.has(id),
      );
      if (removedCertificationIds.length) {
        await tx
          .delete(schema.applicantCertifications)
          .where(
            and(
              eq(schema.applicantCertifications.applicantId, row.id),
              inArray(schema.applicantCertifications.id, removedCertificationIds),
            ),
          );
      }

      if (input.preferences) {
        await tx
          .insert(schema.applicantPreferences)
          .values({ applicantId: row.id, ...input.preferences })
          .onConflictDoUpdate({
            target: schema.applicantPreferences.applicantId,
            set: input.preferences,
          });
      } else if (input.preferences === null) {
        await tx
          .delete(schema.applicantPreferences)
          .where(eq(schema.applicantPreferences.applicantId, row.id));
      }

      const completeness = await completenessFor(tx, {
        ...row,
        hasNoExperience: input.experience.hasNoExperience,
      });
      if (completeness.percent !== row.profileCompleteness) {
        await tx
          .update(a)
          .set({ profileCompleteness: completeness.percent })
          .where(eq(a.id, row.id));
      }

      audit({
        action: 'applicant.profile_update',
        entityType: 'applicant',
        entityId: row.id,
        branchId: row.branchId,
        before: {
          fullName: row.fullName,
          fatherName: row.fatherName,
          email: row.email,
        },
        after: {
          fullName: input.fullName,
          fatherName: input.fatherName,
          email: input.email ?? null,
        },
        metadata: {
          identityReset: identityChanged && row.identityStatus !== 'UNVERIFIED',
          educationCount: input.education.items.length,
          experienceCount: input.experience.items.length,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, 'applicants_cnic_unique')) {
      throw new ConflictError('Another applicant already has this CNIC');
    }
    throw error;
  }
  return getApplicantForStaff(ctx.actor, applicantId);
}

export interface ApplicantListItem {
  id: string;
  fullName: string;
  /** "42101-•••••••-1": lists never show the full CNIC. */
  cnicMasked: string;
  phoneMasked: string | null;
  status: ApplicantStatus;
  identityStatus: IdentityStatus;
  profileCompleteness: number;
  branchName: string | null;
  cityLabel: string | null;
  areaLabel: string | null;
  createdAt: string;
}

export async function listApplicants(
  actor: Actor,
  query: ListQuery<
    (typeof APPLICANT_SORTABLE)[number],
    {
      status?: ApplicantStatus[];
      identityStatus?: IdentityStatus[];
      branchId?: string[];
      cityCode?: string[];
      areaCode?: string[];
      skillCode?: string[];
      createdFrom?: string;
      createdTo?: string;
    }
  >,
) {
  assertPermission(actor, 'applicant:read');
  const f = query.filters;
  if (f.createdFrom && f.createdTo && f.createdFrom > f.createdTo) {
    throw new ValidationError([
      { path: 'createdFrom', message: 'Registered from must be on or before Registered to' },
    ]);
  }
  const outOfScopeBranch =
    f.branchId && !isSuperAdmin(actor)
      ? f.branchId.find((id) => !actor.branchIds.includes(id))
      : undefined;
  if (outOfScopeBranch) {
    throw new ScopeViolationError(undefined, {
      entityType: 'branch',
      entityId: outOfScopeBranch,
      branchId: outOfScopeBranch,
    });
  }

  // City-based scoping: staff see all applicants whose branch's city matches
  // any city of their branches. Scoped on the applicant's branch (a.branchId),
  // NOT on the address row: counter registrations create no address, and an
  // applicant whose address city differs from their branch city must still
  // be listed (audit 2026-11-11, H-04 — address-scoped lists hid exactly
  // those applicants, while the detail route already scoped on branchId).
  // A Super Admin with a branch selected in the switcher sees only that
  // branch's applicants, like every other dashboard count (H9).
  const cityScope: SQL | undefined = isSuperAdmin(actor)
    ? actor.activeBranchId
      ? eq(a.branchId, actor.activeBranchId)
      : undefined
    : branchCityScope(actor, a.branchId);

  const conditions: (SQL | undefined)[] = [
    cityScope,
    f.status?.length ? inArray(a.status, f.status) : undefined,
    f.identityStatus?.length ? inArray(a.identityStatus, f.identityStatus) : undefined,
    f.branchId?.length ? inArray(a.branchId, f.branchId) : undefined,
    f.cityCode?.length ? inArray(addr.cityCode, f.cityCode) : undefined,
    f.areaCode?.length ? inArray(addr.areaCode, f.areaCode) : undefined,
    // Registration date range: from is the start of that day in Pakistan time,
    // to is the end (exclusive start of the next Pakistan day).
    f.createdFrom ? gte(a.createdAt, pktDayStart(f.createdFrom)) : undefined,
    f.createdTo ? lt(a.createdAt, pktDayStart(nextDay(f.createdTo))) : undefined,
    f.skillCode?.length
      ? exists(
          db
            .select({ one: sql`1` })
            .from(skl)
            .where(and(eq(skl.applicantId, a.id), inArray(skl.skillCode, f.skillCode))),
        )
      : undefined,
  ];
  if (query.q) {
    // Names by substring; CNIC and phone by their digits (staff often have only one of them);
    // city/area by the label staff see ("Gulshan" finds Gulshan-e-Iqbal).
    const digits = query.q.replace(/\D/g, '');
    const phone = digits.length >= 10 ? normalizePkMobile(digits) : null;
    conditions.push(
      or(
        ilike(a.fullName, likeContains(query.q)),
        digits.length >= 5 ? sql`${a.cnic} like ${`${digits}%`}` : undefined,
        phone ? eq(schema.users.phoneNumber, phone) : undefined,
        exists(
          db
            .select({ one: sql`1` })
            .from(schema.masterData)
            .where(
              and(
                inArray(schema.masterData.type, ['CITY', 'AREA']),
                ilike(schema.masterData.label, likeContains(query.q)),
                or(
                  eq(schema.masterData.code, addr.cityCode),
                  eq(schema.masterData.code, addr.areaCode),
                ),
              ),
            ),
        ),
      ),
    );
  }
  const where = and(...conditions);

  const sortColumn = {
    fullName: a.fullName,
    createdAt: a.createdAt,
    profileCompleteness: a.profileCompleteness,
  }[query.sort.field];
  const base = () =>
    db
      .select({
        id: a.id,
        fullName: a.fullName,
        cnic: a.cnic,
        phone: schema.users.phoneNumber,
        status: a.status,
        identityStatus: a.identityStatus,
        profileCompleteness: a.profileCompleteness,
        branchName: schema.branches.name,
        cityCode: addr.cityCode,
        areaCode: addr.areaCode,
        createdAt: a.createdAt,
      })
      .from(a)
      .innerJoin(schema.users, eq(schema.users.id, a.userId))
      .leftJoin(schema.branches, eq(schema.branches.id, a.branchId))
      .leftJoin(addr, eq(addr.applicantId, a.id));

  const [rows, [total], labels] = await Promise.all([
    base()
      .where(where)
      .orderBy(query.sort.direction === 'asc' ? asc(sortColumn) : desc(sortColumn), asc(a.id))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ value: count() })
      .from(a)
      .innerJoin(schema.users, eq(schema.users.id, a.userId))
      .leftJoin(addr, eq(addr.applicantId, a.id))
      .where(where),
    masterDataLabels(['CITY', 'AREA']),
  ]);

  return {
    data: rows.map((row): ApplicantListItem => ({
      id: row.id,
      fullName: row.fullName,
      cnicMasked: maskCnic(row.cnic),
      phoneMasked: row.phone ? maskPhone(row.phone) : null,
      status: row.status,
      identityStatus: row.identityStatus,
      profileCompleteness: row.profileCompleteness,
      branchName: row.branchName,
      cityLabel: row.cityCode ? (labels.CITY?.[row.cityCode] ?? row.cityCode) : null,
      areaLabel: row.areaCode ? (labels.AREA?.[row.areaCode] ?? row.areaCode) : null,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: paginationMeta(query, total?.value ?? 0),
  };
}

// ─── Detail ────────────────────────────────────────────────────────────

export interface IdentityCheckView {
  id: string;
  outcome: IdentityOutcome;
  method: IdentityMethod;
  notes: string | null;
  verifiedByName: string | null;
  createdAt: string;
  /** False when the CNIC was corrected after this check. */
  cnicMatchesCurrent: boolean;
}

export interface ApplicantStaffView extends ApplicantProfile {
  userId: string;
  statusReason: string | null;
  createdByStaff: { name: string | null; roleLabel: string | null } | null;
  /** Registered by staff at a counter: no login, and staff act for the candidate. */
  counterRegistered: boolean;
  identityHistory: IdentityCheckView[];
  /** What the signed-in staff member may do (drives the UI). */
  can: {
    verifyIdentity: boolean;
    manage: boolean;
    transfer: boolean;
    shortlist: boolean;
    scheduleInterview: boolean;
    referToEmployer: boolean;
    /** 0052 — holds interview:record_outcome (interviewer, staff, branch admin). */
    recordInterviewOutcome: boolean;
    /** 0052 — interviewer-only actor: their referral is pass-only. */
    referPassedOnly: boolean;
  };
}

async function scopedApplicant(actor: Actor, applicantId: string): Promise<ApplicantRow> {
  const row = await loadApplicant(db, applicantId);
  await assertCityAccess(actor, row.branchId, { entityType: 'applicant', entityId: row.id });
  return row;
}

/** Staff creates an applicant profile for a person at the branch. It is ACTIVE from creation (no DRAFT status since 2026-11-09). */
export async function staffRegisterApplicant(
  ctx: SignedIn,
  input: StaffRegisterApplicantInput,
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:manage');
  if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, input.branchId);

  const phone = normalizePkMobile(input.phone);
  if (!phone) {
    throw new ValidationError([{ path: 'phone', message: 'Enter a Pakistani mobile number' }]);
  }

  try {
    let applicantId: string | undefined;
    await runCommand(ctx, async (cmd) => {
      const { tx, audit } = cmd;
      const owner = await cnicOwner(tx, input.cnic);
      if (owner) throw await cnicTakenError(tx, owner);
      if (input.email) await assertEmailFree(tx, input.email);

      const [existingPhone] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phoneNumber, phone));
      if (existingPhone) {
        throw new ConflictError('This number is already registered. Please use account recovery.');
      }

      const [user] = await tx
        .insert(schema.users)
        .values({
          name: input.fullName,
          email: placeholderEmailFor(phone),
          phoneNumber: phone,
          phoneNumberVerified: false,
        })
        .returning({ id: schema.users.id });
      await tx.insert(schema.userRoles).values({ userId: user!.id, roleCode: 'APPLICANT' });

      let reservedReference: string | null = null;
      if (input.tokenId) {
        const [tokenRow] = await tx
          .select({ registrationReference: schema.branchApplicantTokens.registrationReference })
          .from(schema.branchApplicantTokens)
          .where(eq(schema.branchApplicantTokens.id, input.tokenId));
        reservedReference = tokenRow?.registrationReference ?? null;
      }
      const [row] = await withRegistrationReference(
        tx,
        { reserved: reservedReference },
        (reference) =>
          tx
            .insert(a)
            .values({
              userId: user!.id,
              branchId: input.branchId,
              registrationReference: reference,
              fullName: input.fullName,
              fatherName: input.fatherName,
              cnic: input.cnic,
              dateOfBirth: input.dateOfBirth,
              gender: input.gender,
              email: input.email ?? null,
              additionalNotes: input.additionalNotes ?? null,
              activatedAt: new Date(),
            })
            .returning(),
      );
      applicantId = row!.id;

      if (input.address) {
        await assertCityArea(tx, input.address, 'address');
        await tx.insert(addr).values({
          applicantId: row!.id,
          addressLine: input.address.addressLine ?? '',
          cityCode: input.address.cityCode,
          areaCode: input.address.areaCode,
          location: input.address.location,
        });
      }

      if (input.permanentAddress) {
        await assertCityArea(tx, input.permanentAddress, 'permanentAddress');
        await tx.insert(permAddr).values({
          applicantId: row!.id,
          addressLine: input.permanentAddress.addressLine,
          cityCode: input.permanentAddress.cityCode,
          areaCode: input.permanentAddress.areaCode,
        });
      }

      if (input.education) {
        await assertActiveMasterData(
          tx,
          'EDUCATION_LEVEL',
          input.education.items.map((item) => item.levelCode),
          (index) => `education.items.${index}.levelCode`,
        );
        if (input.education.items.length) {
          await tx.insert(edu).values(
            input.education.items.map((item, sortOrder) => ({
              ...item,
              applicantId: row!.id,
              sortOrder,
            })),
          );
        }
      }

      if (input.experience) {
        const categories = input.experience.items.flatMap((item, index) =>
          item.categoryCode ? [{ code: item.categoryCode, index }] : [],
        );
        if (categories.length) {
          await assertActiveMasterData(
            tx,
            'JOB_CATEGORY',
            categories.map((item) => item.code),
            (index) => `experience.items.${categories[index]!.index}.categoryCode`,
          );
        }
        if (input.experience.items.length) {
          await tx.insert(exp).values(
            input.experience.items.map((item, sortOrder) => ({
              ...item,
              startMonth: `${item.startMonth}-01`,
              endMonth: item.endMonth ? `${item.endMonth}-01` : null,
              applicantId: row!.id,
              sortOrder,
            })),
          );
        }
        await tx
          .update(a)
          .set({ hasNoExperience: input.experience.hasNoExperience })
          .where(eq(a.id, row!.id));
      }

      if (input.skills?.items.length) {
        // Skills must already exist as active master data (H14): staff may not
        // mint new SKILL codes — an unknown code is "not offered", like every
        // other section in this form.
        await assertActiveMasterData(
          tx,
          'SKILL',
          input.skills.items.map((item) => item.skillCode),
          (index) => `skills.items.${index}.skillCode`,
        );
        await tx
          .insert(skl)
          .values(input.skills.items.map((item) => ({ ...item, applicantId: row!.id })));
      }

      if (input.languages) {
        await assertActiveMasterData(
          tx,
          'LANGUAGE',
          input.languages.items.map((item) => item.languageCode),
          (index) => `languages.items.${index}.languageCode`,
        );
        if (input.languages.items.length) {
          await tx
            .insert(lng)
            .values(input.languages.items.map((item) => ({ ...item, applicantId: row!.id })));
        }
      }

      if (input.certifications?.items.length) {
        await tx.insert(cert).values(
          input.certifications.items.map((item, sortOrder) => ({
            name: item.name,
            issuer: item.issuer,
            issuedMonth: item.issuedMonth ? `${item.issuedMonth}-01` : null,
            expiresMonth: item.expiresMonth ? `${item.expiresMonth}-01` : null,
            applicantId: row!.id,
            sortOrder,
          })),
        );
      }

      if (input.preferences) {
        await assertActiveMasterData(
          tx,
          'JOB_CATEGORY',
          input.preferences.categoryCodes,
          (index) => `preferences.categoryCodes.${index}`,
        );
        await tx.insert(pref).values({
          applicantId: row!.id,
          ...input.preferences,
        });
      }

      // Step 2 (2026-11-08): a registration that names a first-counter token
      // completes it in this same transaction — the token must be ISSUED,
      // unexpired, for this branch and CNIC, or the whole registration fails.
      if (input.tokenId) {
        await completeTokenForRegistration(tx, audit, {
          tokenId: input.tokenId,
          applicantId: row!.id,
          branchId: input.branchId,
          cnic: input.cnic,
        });
      }

      audit({
        action: 'applicant.register_by_staff',
        entityType: 'applicant',
        entityId: row!.id,
        branchId: input.branchId,
        after: {
          fullName: input.fullName,
          fatherName: input.fatherName,
          cnic: input.cnic,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          email: input.email ?? null,
          phone,
          branchId: input.branchId,
          profile: {
            address: input.address,
            permanentAddress: input.permanentAddress,
            additionalNotes: input.additionalNotes ?? null,
            education: input.education,
            experience: input.experience,
            skills: input.skills,
            languages: input.languages,
            certifications: input.certifications,
            preferences: input.preferences,
          },
        },
        metadata: { createdBy: ctx.actor.userId, tokenId: input.tokenId ?? null },
      });
      // Recompute completeness in the same step (profiles are ACTIVE from
      // creation; there is no activation step any more).
      await refreshProfileState(cmd, row!.id);
    });

    if (!applicantId) throw new Error('Applicant registration completed without an applicant.');
    return getApplicantForStaff(ctx.actor, applicantId);
  } catch (error) {
    if (
      isUniqueViolation(error, 'applicants_cnic_unique') ||
      (error instanceof ConflictError &&
        (error.details as { reason?: string } | undefined)?.reason === 'CNIC_TAKEN')
    ) {
      const owner = await cnicOwner(db, input.cnic);
      if (owner) {
        await recordAudit(ctx, {
          action: 'applicant.register_duplicate_cnic',
          entityType: 'applicant',
          entityId: owner.id,
          branchId: input.branchId,
          metadata: { createdBy: ctx.actor.userId },
        });
        throw await cnicTakenError(db, owner);
      }
    }
    if (isUniqueViolation(error, 'users_phone_number_unique')) {
      const [phoneOwner] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phoneNumber, phone));
      await recordAudit(ctx, {
        action: 'applicant.register_duplicate_phone',
        entityType: 'user',
        entityId: phoneOwner?.id,
        branchId: input.branchId,
        metadata: { createdBy: ctx.actor.userId },
      });
      throw new ConflictError('This number is already registered. Please use account recovery.');
    }
    if (isUniqueViolation(error)) {
      // Any other unique violation (e.g. a placeholder-email collision) is not a
      // phone conflict — do not misreport it as one.
      throw new ConflictError(
        'This registration could not be saved because some details are already in use.',
      );
    }
    throw error;
  }
}

/**
 * Records the first-counter paper review.
 *
 * Deliberate asymmetry with companies, kept as a product decision: for companies the
 * verified-and-signed mark GATES the next step (markCompanyRegistrationVerifiedSigned
 * submits the DRAFT to Branch Admin review in the same step). For applicants it is
 * record-only evidence of the paper review — it does NOT gate anything. Nothing in
 * the codebase gates applicant activation or matching on
 * registrationVerifiedSignedAt; the timestamp is the audit evidence that the
 * first-counter review happened. (The old DRAFT-only gate is gone with the
 * DRAFT status itself, removed 2026-11-09.)
 */
export async function markApplicantRegistrationVerifiedSigned(
  ctx: SignedIn,
  applicantId: string,
): Promise<{ verifiedSignedAt: Date; verifiedSignedBy: string }> {
  assertRole(ctx.actor, 'STAFF', 'BRANCH_ADMIN', 'SUPER_ADMIN');
  assertPermission(ctx.actor, 'applicant:manage');
  const applicant = await loadApplicant(db, applicantId);
  if (!isSuperAdmin(ctx.actor)) {
    assertBranchAccess(ctx.actor, applicant.branchId, {
      entityType: 'applicant',
      entityId: applicant.id,
    });
  }
  const verifiedAt = new Date();
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadApplicant(tx, applicantId, { forUpdate: true });
    if (row.registrationVerifiedSignedAt) {
      throw new ConflictError('This registration form was already marked verified and signed.');
    }
    // Audit 2026-11-11 (M-24): same separation-of-duties rule as the
    // company path — the staff member who registered the applicant at
    // the counter must not mark their own paper form verified & signed.
    // A colleague in the branch records it instead.
    if (row.counterRegisteredBy === ctx.actor.userId) {
      throw new ConflictError(
        'You cannot mark a registration form verified and signed for an applicant you registered. Ask another staff member in your branch.',
        { reason: 'SELF_ATTESTATION' },
      );
    }
    await tx
      .update(a)
      .set({
        registrationVerifiedSignedAt: verifiedAt,
        registrationVerifiedSignedBy: ctx.actor.userId,
      })
      .where(eq(a.id, row.id));
    audit({
      action: 'applicant.registration_form_verified_signed',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      after: { status: row.status, verifiedSigned: true },
      metadata: { verifiedBy: ctx.actor.userId },
    });
  });
  return { verifiedSignedAt: verifiedAt, verifiedSignedBy: ctx.actor.userId };
}

export async function getApplicantForStaff(
  actor: Actor,
  applicantId: string,
): Promise<ApplicantStaffView> {
  assertPermission(actor, 'applicant:read');
  const row = await scopedApplicant(actor, applicantId);
  const [profile, history, staffCreator] = await Promise.all([
    buildProfile(db, row),
    db
      .select({
        id: idv.id,
        outcome: idv.outcome,
        method: idv.method,
        notes: idv.notes,
        cnic: idv.cnic,
        verifiedByName: schema.users.name,
        createdAt: idv.createdAt,
      })
      .from(idv)
      .leftJoin(schema.users, eq(schema.users.id, idv.verifiedBy))
      .where(eq(idv.applicantId, row.id))
      .orderBy(desc(idv.createdAt)),
    db
      .select({ name: schema.users.name, actorRole: schema.auditLogs.actorRole })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
      .where(
        and(
          eq(schema.auditLogs.action, 'applicant.register_by_staff'),
          eq(schema.auditLogs.entityType, 'applicant'),
          eq(schema.auditLogs.entityId, row.id),
        ),
      )
      .orderBy(asc(schema.auditLogs.occurredAt), asc(schema.auditLogs.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  const creatorRole = staffCreator
    ? ROLES.find((role: Role) => staffCreator.actorRole?.split(',').includes(role))
    : undefined;
  return {
    ...profile,
    userId: row.userId,
    statusReason: row.statusReason,
    createdByStaff: staffCreator
      ? { name: staffCreator.name, roleLabel: creatorRole ? ROLE_LABELS[creatorRole] : null }
      : null,
    counterRegistered: row.counterRegisteredBy !== null,
    identityHistory: history.map((h) => ({
      id: h.id,
      outcome: h.outcome,
      method: h.method,
      notes: h.notes,
      verifiedByName: h.verifiedByName,
      createdAt: h.createdAt.toISOString(),
      cnicMatchesCurrent: h.cnic === row.cnic,
    })),
    can: {
      verifyIdentity:
        hasPermission(actor, 'applicant:verify_identity') && actor.userId !== row.userId,
      manage: hasPermission(actor, 'applicant:manage'),
      transfer: hasPermission(actor, 'applicant:transfer'),
      shortlist: hasPermission(actor, 'match_case:manage') && row.status === 'ACTIVE',
      scheduleInterview:
        hasPermission(actor, 'interview:schedule_jobbank') && row.status === 'ACTIVE',
      referToEmployer: hasPermission(actor, 'match_case:refer') && row.status === 'ACTIVE',
      recordInterviewOutcome:
        hasPermission(actor, 'interview:record_outcome') && row.status === 'ACTIVE',
      // 0052 — interviewer-only referral is pass-only; dual-role Staff/BA
      // users are treated as Staff/BA (see isInterviewerOnlyReferrer).
      referPassedOnly:
        actor.roles.includes('INTERVIEWER_SCHEDULER') &&
        !actor.roles.some((r) => r === 'STAFF' || r === 'BRANCH_ADMIN'),
    },
  };
}

// ─── Identity verification ─────────────────────────────────────────────

/**
 * Records a staff identity check (append-only) and updates the applicant's identity status.
 * A VERIFIED outcome needs the CNIC evidence behind it whatever the method: both uploaded
 * sides, or — for an in-person check — a note saying the original card was seen. A document
 * review marks those documents accepted or rejected along with the check.
 */
export async function verifyApplicantIdentity(
  ctx: SignedIn,
  applicantId: string,
  input: IdentityVerificationInput,
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:verify_identity');
  await scopedApplicant(ctx.actor, applicantId);
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadApplicant(tx, applicantId, { forUpdate: true });
    if (row.userId === ctx.actor.userId) {
      throw new ForbiddenError('You cannot verify your own identity');
    }
    if (input.outcome === 'VERIFIED' && row.identityStatus === 'VERIFIED') {
      throw new ConflictError('This identity is already verified');
    }
    const current = await currentDocuments(tx, row.id);
    const front = current.find((d) => d.typeCode === 'CNIC_FRONT') ?? null;
    const back = current.find((d) => d.typeCode === 'CNIC_BACK') ?? null;
    if (input.outcome === 'VERIFIED') {
      // A VERIFIED mark needs the CNIC evidence behind it, whatever the method (L18):
      // both uploaded sides, or — for an in-person check — a written note saying
      // the original card was seen (that note is the method-specific justification).
      const inPersonJustification =
        input.method === 'IN_PERSON' && (input.notes?.trim().length ?? 0) >= 5;
      if (!front || !back) {
        if (!inPersonJustification) {
          throw new ConflictError(
            'To mark this identity verified, the applicant must have uploaded both sides of ' +
              'their CNIC, or — for an in-person check — record in the notes that you saw the original card.',
          );
        }
      }
    }
    const now = new Date();
    await tx.insert(idv).values({
      applicantId: row.id,
      cnic: row.cnic,
      method: input.method,
      outcome: input.outcome,
      notes: input.notes,
      frontDocumentId: front?.id ?? null,
      backDocumentId: back?.id ?? null,
      verifiedBy: ctx.actor.userId,
    });
    await tx.update(a).set({ identityStatus: input.outcome }).where(eq(a.id, row.id));
    if (input.method === 'DOCUMENT_REVIEW') {
      // Audit 2026-11-11 (H-05): only the sides that were actually uploaded
      // get a review status. The old code asserted front!.id/back!.id, so
      // rejecting precisely because the CNIC was never uploaded (or only the
      // front was) threw TypeError, rolled the transaction back, and never
      // recorded the rejection. A rejection note is already required by the
      // schema, so the reason is on the verification row either way.
      const docIds = [front, back]
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .map((d) => d.id);
      if (docIds.length > 0) {
        await tx
          .update(docs)
          .set({
            status: input.outcome === 'VERIFIED' ? 'ACCEPTED' : 'REJECTED',
            reviewNote: input.outcome === 'VERIFIED' ? null : input.notes,
            reviewedBy: ctx.actor.userId,
            reviewedAt: now,
          })
          .where(inArray(docs.id, docIds));
      }
    }
    audit({
      action:
        input.outcome === 'VERIFIED' ? 'applicant.identity_verify' : 'applicant.identity_reject',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      before: { identityStatus: row.identityStatus },
      after: { identityStatus: input.outcome, method: input.method },
      reason: input.notes,
    });
  });
  return getApplicantForStaff(ctx.actor, applicantId);
}

// ─── Corrections & account recovery ────────────────────────────────────

/**
 * Staff correct personal details (e.g. a typo found during the identity check). Changing an
 * identity field resets the identity status, so the profile is checked again.
 */
export async function staffUpdateApplicant(
  ctx: SignedIn,
  applicantId: string,
  input: UpdatePersonalInput & { reason: string },
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:manage');
  const { reason, ...fields } = input;
  await scopedApplicant(ctx.actor, applicantId);
  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      const row = await loadApplicant(tx, applicantId, { forUpdate: true });
      const changes = Object.fromEntries(
        Object.entries(fields).filter(
          ([k, v]) => v !== undefined && v !== row[k as keyof ApplicantRow],
        ),
      ) as UpdatePersonalInput;
      if (Object.keys(changes).length === 0) throw new ConflictError('Nothing was changed');
      if (changes.cnic) {
        const owner = await cnicOwner(tx, changes.cnic, row.id);
        if (owner) throw await cnicTakenError(tx, owner);
      }
      if (changes.email) await assertEmailFree(tx, changes.email, row.id);
      const identityChanged = IDENTITY_FIELDS.some((field) => field in changes);
      await tx
        .update(a)
        .set({
          ...changes,
          identityStatus: identityChanged ? 'UNVERIFIED' : row.identityStatus,
        })
        .where(eq(a.id, row.id));
      if (changes.fullName) {
        await tx
          .update(schema.users)
          .set({ name: changes.fullName })
          .where(eq(schema.users.id, row.userId));
      }
      audit({
        action: 'applicant.staff_update',
        entityType: 'applicant',
        entityId: row.id,
        branchId: row.branchId,
        before: Object.fromEntries(
          Object.keys(changes).map((k) => [k, row[k as keyof ApplicantRow]]),
        ),
        after: changes,
        reason,
        metadata: { identityReset: identityChanged && row.identityStatus !== 'UNVERIFIED' },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, 'applicants_cnic_unique')) {
      throw new ConflictError('Another applicant already has this CNIC');
    }
    throw error;
  }
  return getApplicantForStaff(ctx.actor, applicantId);
}

/**
 * Step 1 of the M-21 phone-change flow: text a 6-digit code to the NEW
 * number so it can prove itself before the profile moves to it. The number
 * must be free (not the applicant's current one, not another account's) —
 * checked here and re-checked under lock in changeApplicantPhone, so a code
 * is never spent on a change that cannot happen.
 */
export async function requestPhoneChangeCode(
  ctx: SignedIn,
  applicantId: string,
  phoneInput: string,
): Promise<{ maskedPhone: string }> {
  assertPermission(ctx.actor, 'applicant:manage');
  const phone = normalizePkMobile(phoneInput);
  if (!phone) {
    throw new ValidationError([{ path: 'phone', message: 'Enter a Pakistani mobile number' }]);
  }
  await scopedApplicant(ctx.actor, applicantId);
  await assertPhoneFreeForChange(applicantId, phone);
  await enforceRateLimit(
    'phone-change-code',
    `${ctx.actor.userId}:${applicantId}`,
    { limit: 5, windowSeconds: 3600 },
    'Too many codes requested for this applicant. Try again in an hour.',
  );
  await issueOtp(phone, ctx.ip);
  return { maskedPhone: maskPhone(phone) };
}

/** The new number must not be the applicant's current one or another account's. */
async function assertPhoneFreeForChange(applicantId: string, phone: string): Promise<void> {
  const row = await loadApplicant(db, applicantId);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, row.userId));
  if (user!.phoneNumber === phone) throw new ConflictError('This is already their number');
  const [taken] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.phoneNumber, phone));
  if (taken) {
    throw new ConflictError(
      'This number is used by another account. That account must be closed first.',
    );
  }
}

/**
 * Account recovery (owner decision 3): the applicant lost their SIM, or registered the CNIC
 * from another number. Staff move the profile to the new number; old sessions end.
 */
export async function changeApplicantPhone(
  ctx: SignedIn,
  applicantId: string,
  input: { phone: string; reason: string; code: string },
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:manage');
  const phone = normalizePkMobile(input.phone);
  if (!phone) {
    throw new ValidationError([{ path: 'phone', message: 'Enter a Pakistani mobile number' }]);
  }
  await scopedApplicant(ctx.actor, applicantId);
  // The number must still be free before the code is spent — the transaction
  // below re-checks under lock, but a code consumed on a doomed change would
  // force the applicant to wait for a new one.
  await assertPhoneFreeForChange(applicantId, phone);
  // Audit 2026-11-11 (M-21): the new number proves itself. A correct code is
  // consumed exactly once by verifyOtpCode; a wrong, expired or locked code
  // rejects here, and the number is never marked verified on staff say-so
  // alone — the old code set phoneNumberVerified: true unconditionally.
  const check = await verifyOtpCode(phone, input.code);
  if (check !== 'ok') {
    throw new ValidationError([
      {
        path: 'code',
        message:
          check === 'expired'
            ? 'The code has expired — request a new one'
            : check === 'locked'
              ? 'Too many wrong attempts — request a new code'
              : 'The code is incorrect',
      },
    ]);
  }
  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      const row = await loadApplicant(tx, applicantId, { forUpdate: true });
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, row.userId));
      if (user!.phoneNumber === phone) throw new ConflictError('This is already their number');
      const [taken] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phoneNumber, phone));
      if (taken) {
        throw new ConflictError(
          'This number is used by another account. That account must be closed first.',
        );
      }
      await tx
        .update(schema.users)
        .set({
          phoneNumber: phone,
          phoneNumberVerified: true,
          // The placeholder email is derived from the phone, so a new sign-up with the old
          // number must not collide with it.
          ...(isPlaceholderEmail(user!.email) ? { email: placeholderEmailFor(phone) } : {}),
        })
        .where(eq(schema.users.id, row.userId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, row.userId));
      audit({
        action: 'applicant.phone_change',
        entityType: 'applicant',
        entityId: row.id,
        branchId: row.branchId,
        reason: input.reason,
        metadata: {
          from: user!.phoneNumber ? maskPhone(user!.phoneNumber) : null,
          to: maskPhone(phone),
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        'This number is used by another account. That account must be closed first.',
      );
    }
    throw error;
  }
  return getApplicantForStaff(ctx.actor, applicantId);
}

/** Staff deactivate (e.g. unreachable, found work elsewhere) or reactivate, with a reason. */
export async function staffSetApplicantStatus(
  ctx: SignedIn,
  applicantId: string,
  input: { status: 'ACTIVE' | 'INACTIVE'; reason: string },
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:manage');
  await scopedApplicant(ctx.actor, applicantId);
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadApplicant(tx, applicantId, { forUpdate: true });
    const event = input.status === 'INACTIVE' ? 'DEACTIVATE' : 'REACTIVATE';
    // REACTIVATE re-checks completeness (the machine guards it): a profile that
    // lost its documents or location while inactive must not come back ACTIVE
    // and matchable. DEACTIVATE needs no such check, so it is not computed.
    const activationMissing =
      event === 'REACTIVATE' ? (await completenessFor(tx, row)).activationMissing : [];
    const to = applicantMachine.transition(
      row.status,
      event,
      { activationMissing },
      ctx.actor.roles,
    );
    await tx
      .update(a)
      .set({ status: to, statusReason: input.status === 'INACTIVE' ? input.reason : null })
      .where(eq(a.id, row.id));
    audit({
      action: input.status === 'INACTIVE' ? 'applicant.deactivate' : 'applicant.reactivate',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      reason: input.reason,
      metadata: { by: 'staff' },
    });
  });
  return getApplicantForStaff(ctx.actor, applicantId);
}

/**
 * Branch Admin (of the current branch) or Super Admin moves an applicant to another branch.
 * Returns only the new branch: a Branch Admin can no longer open the profile afterwards.
 */
export async function transferApplicant(
  ctx: SignedIn,
  applicantId: string,
  input: { branchId: string; expectedBranchId?: string; reason: string },
): Promise<{ applicantId: string; branch: BranchContact }> {
  assertPermission(ctx.actor, 'applicant:transfer');
  const source = await scopedApplicant(ctx.actor, applicantId);
  if (!isSuperAdmin(ctx.actor) && !input.expectedBranchId) {
    throw new ValidationError([
      { path: 'expectedBranchId', message: 'Current branch is required' },
    ]);
  }
  return runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadApplicant(tx, applicantId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'applicant', entityId: row.id });
    if (row.branchId !== (input.expectedBranchId ?? source.branchId)) {
      throw new ConflictError('The applicant branch has changed. Refresh and try again.');
    }
    if (row.branchId === input.branchId) {
      throw new ConflictError('The applicant is already in this branch');
    }
    const target = await getBranchContact(input.branchId, tx);
    if (!target?.isActive) {
      throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
    }
    // The destination must be one of the actor's own branches (M13) — a Branch
    // Admin cannot move an applicant to a branch in another city. Super Admins
    // move applicants anywhere.
    if (!isSuperAdmin(ctx.actor) && !ctx.actor.branchIds.includes(input.branchId)) {
      throw new ScopeViolationError(undefined, {
        entityType: 'branch',
        entityId: input.branchId,
        branchId: input.branchId,
      });
    }
    await tx.update(a).set({ branchId: input.branchId }).where(eq(a.id, row.id));
    audit({
      action: 'applicant.transfer',
      entityType: 'applicant',
      entityId: row.id,
      branchId: input.branchId,
      before: { branchId: row.branchId },
      after: { branchId: input.branchId },
      reason: input.reason,
    });
    return { applicantId: row.id, branch: target };
  });
}
