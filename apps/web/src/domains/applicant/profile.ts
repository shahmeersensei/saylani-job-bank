import 'server-only';
import { schema, type GeoPoint } from '@jobbank/db';
import type {
  ApplicantLocationInput,
  CertificationsInput,
  EducationInput,
  ExperienceInput,
  LanguagesInput,
  PreferencesInput,
  RegisterApplicantInput,
  SkillsInput,
  UpdatePersonalInput,
} from '@jobbank/shared';
import { eq } from 'drizzle-orm';
import { getBranchContact, listBranchOptions, type BranchOption } from '@/domains/branch';
import { assertActiveMasterData, resolveMatchRadius } from '@/domains/settings';
import { recordAudit, runCommand, type CommandScope } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  ValidationError,
} from '@/domains/shared/errors';
import { assertPermission, type Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';
import { applicantMachine } from './machine';
import {
  a,
  addr,
  branchLocked,
  buildProfile,
  cert,
  cnicOwner,
  edu,
  exp,
  findApplicantForUser,
  fromMonth,
  identityLocked,
  lng,
  pref,
  refreshProfileState,
  requireOwnApplicant,
  skl,
  type ApplicantProfile,
  type ApplicantRow,
  type SignedIn,
} from './repository';

/** Fields printed on the CNIC: locked once staff verified the identity. */
export const IDENTITY_FIELDS = ['fullName', 'fatherName', 'cnic', 'dateOfBirth'] as const;

/**
 * "Already registered" with the branch that holds the profile, so the person can recover
 * their account there (owner decision 3). The other account's phone is never revealed.
 */
export async function cnicTakenError(
  executor: DbExecutor,
  owner: ApplicantRow,
): Promise<ConflictError> {
  const branch = owner.branchId ? await getBranchContact(owner.branchId, executor) : null;
  const where = branch
    ? `the ${branch.name} branch${branch.phone ? ` on ${branch.phone}` : ''}`
    : 'your nearest Saylani Job Bank branch';
  return new ConflictError(
    `This CNIC is already registered. To recover your account, please contact ${where}.`,
    {
      reason: 'CNIC_TAKEN',
      branch: branch ? { name: branch.name, phone: branch.phone, address: branch.address } : null,
    },
  );
}

// ─── Reads ─────────────────────────────────────────────────────────────

/** The signed-in applicant's profile, or null before they register. */
export async function getMyProfile(actor: Actor): Promise<ApplicantProfile | null> {
  assertPermission(actor, 'applicant:self');
  const row = await findApplicantForUser(db, actor.userId);
  return row ? buildProfile(db, row) : null;
}

async function myProfile(actor: Actor): Promise<ApplicantProfile> {
  return buildProfile(db, await requireOwnApplicant(db, actor));
}

/** Active branches nearest-first from the applicant's pin; the first is the suggestion. */
export async function myBranchOptions(actor: Actor, point: GeoPoint): Promise<BranchOption[]> {
  assertPermission(actor, 'applicant:self');
  return listBranchOptions(point);
}

// ─── Registration & personal details ───────────────────────────────────

/** Step 1 of the wizard: creates the DRAFT profile for the signed-in phone account. */
export async function registerApplicant(
  ctx: SignedIn,
  input: RegisterApplicantInput,
): Promise<ApplicantProfile> {
  assertPermission(ctx.actor, 'applicant:self');
  try {
    await runCommand(ctx, async (cmd) => {
      const { tx, audit } = cmd;
      if (await findApplicantForUser(tx, ctx.actor.userId)) {
        throw new ConflictError('You already have a profile', { reason: 'ALREADY_REGISTERED' });
      }
      const owner = await cnicOwner(tx, input.cnic);
      if (owner) throw await cnicTakenError(tx, owner);
      const [row] = await tx
        .insert(a)
        .values({
          userId: ctx.actor.userId,
          fullName: input.fullName,
          fatherName: input.fatherName,
          cnic: input.cnic,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          email: input.email ?? null,
        })
        .returning();
      // The account was created by phone sign-in with a placeholder name.
      await tx
        .update(schema.users)
        .set({ name: input.fullName })
        .where(eq(schema.users.id, ctx.actor.userId));
      audit({
        action: 'applicant.register',
        entityType: 'applicant',
        entityId: row!.id,
        after: input,
      });
      await refreshProfileState(cmd, row!.id);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'applicants_cnic_unique')) {
      const owner = await cnicOwner(db, input.cnic);
      if (owner) throw await cnicTakenError(db, owner);
    }
    if (isUniqueViolation(error, 'applicants_userId_unique')) {
      throw new ConflictError('You already have a profile', { reason: 'ALREADY_REGISTERED' });
    }
    if (
      error instanceof ConflictError &&
      (error.details as { reason?: string })?.reason === 'CNIC_TAKEN'
    ) {
      // A second account claiming a registered CNIC is worth a look by staff.
      await recordAudit(ctx, {
        action: 'applicant.register_duplicate_cnic',
        entityType: 'user',
        entityId: ctx.actor.userId,
      });
    }
    throw error;
  }
  return myProfile(ctx.actor);
}

/** Only the fields that really change (dates and strings compare as stored). */
function diff<T extends object>(input: Partial<T>, current: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => value !== undefined && value !== current[key as keyof T],
    ),
  ) as Partial<T>;
}

export async function updateMyPersonal(
  ctx: SignedIn,
  input: UpdatePersonalInput,
): Promise<ApplicantProfile> {
  assertPermission(ctx.actor, 'applicant:self');
  const current = await requireOwnApplicant(db, ctx.actor);
  const changes = diff(input, current);
  if (Object.keys(changes).length === 0) return buildProfile(db, current);

  const identityChanged = IDENTITY_FIELDS.some((field) => field in changes);
  if (identityChanged && identityLocked(current)) {
    throw new ForbiddenError(
      'Your identity has been verified, so your CNIC, names and date of birth are locked. ' +
        'Ask your branch to correct them.',
    );
  }
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await requireOwnApplicant(tx, ctx.actor, { forUpdate: true });
    if (changes.cnic) {
      const owner = await cnicOwner(tx, changes.cnic, row.id);
      if (owner) throw await cnicTakenError(tx, owner);
    }
    // Fixing details after a failed check sends the profile back for a new check.
    const identityStatus =
      identityChanged && row.identityStatus === 'REJECTED' ? 'UNVERIFIED' : row.identityStatus;
    await tx
      .update(a)
      .set({ ...changes, identityStatus })
      .where(eq(a.id, row.id));
    if (changes.fullName) {
      await tx
        .update(schema.users)
        .set({ name: changes.fullName })
        .where(eq(schema.users.id, ctx.actor.userId));
    }
    audit({
      action: 'applicant.update_personal',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      before: Object.fromEntries(
        Object.keys(changes).map((k) => [k, row[k as keyof ApplicantRow]]),
      ),
      after: changes,
    });
  });
  return myProfile(ctx.actor);
}

// ─── Location & branch ─────────────────────────────────────────────────

export async function setMyLocation(
  ctx: SignedIn,
  input: ApplicantLocationInput,
): Promise<ApplicantProfile> {
  assertPermission(ctx.actor, 'applicant:self');
  await runCommand(ctx, async (cmd) => {
    const { tx, audit } = cmd;
    const row = await requireOwnApplicant(tx, ctx.actor, { forUpdate: true });
    const city = (await assertActiveMasterData(tx, 'CITY', [input.cityCode], () => 'cityCode')).get(
      input.cityCode,
    )!;
    if (input.areaCode) {
      const area = (
        await assertActiveMasterData(tx, 'AREA', [input.areaCode], () => 'areaCode')
      ).get(input.areaCode)!;
      if (area.parentId !== city.id) {
        throw new ValidationError([
          { path: 'areaCode', message: `This area is not in ${city.label}` },
        ]);
      }
    }
    const branch = await getBranchContact(input.branchId, tx);
    if (!branch?.isActive) {
      throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
    }
    const branchChanged = row.branchId !== input.branchId;
    if (branchChanged && branchLocked(row)) {
      throw new ForbiddenError(
        'Your profile is active, so only Job Bank staff can move it to another branch. ' +
          'Ask your branch to transfer you.',
      );
    }

    const values = {
      addressLine: input.addressLine,
      cityCode: input.cityCode,
      areaCode: input.areaCode,
      location: input.location,
    };
    await tx
      .insert(addr)
      .values({ applicantId: row.id, ...values })
      .onConflictDoUpdate({ target: addr.applicantId, set: values });
    if (branchChanged) await tx.update(a).set({ branchId: input.branchId }).where(eq(a.id, row.id));

    audit({
      action: 'applicant.update_location',
      entityType: 'applicant',
      entityId: row.id,
      branchId: input.branchId,
      // The pin and street address are redacted from the audit log; the codes are kept.
      after: { ...values, branchId: input.branchId },
      metadata: { branchChanged },
    });
    await refreshProfileState(cmd, row.id);
  });
  return myProfile(ctx.actor);
}

// ─── Profile sections (each saved as a whole list) ─────────────────────

async function saveSection(
  ctx: SignedIn,
  section: string,
  after: unknown,
  write: (cmd: CommandScope, row: ApplicantRow) => Promise<void>,
): Promise<ApplicantProfile> {
  assertPermission(ctx.actor, 'applicant:self');
  await runCommand(ctx, async (cmd) => {
    const row = await requireOwnApplicant(cmd.tx, ctx.actor, { forUpdate: true });
    await write(cmd, row);
    cmd.audit({
      action: `applicant.update_${section}`,
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      after,
    });
    await refreshProfileState(cmd, row.id);
  });
  return myProfile(ctx.actor);
}

export function saveMyEducation(ctx: SignedIn, input: EducationInput) {
  return saveSection(ctx, 'education', input, async ({ tx }, row) => {
    await assertActiveMasterData(
      tx,
      'EDUCATION_LEVEL',
      input.items.map((i) => i.levelCode),
      (i) => `items.${i}.levelCode`,
    );
    await tx.delete(edu).where(eq(edu.applicantId, row.id));
    if (input.items.length > 0) {
      await tx
        .insert(edu)
        .values(
          input.items.map((item, sortOrder) => ({ ...item, applicantId: row.id, sortOrder })),
        );
    }
  });
}

export function saveMyExperience(ctx: SignedIn, input: ExperienceInput) {
  return saveSection(ctx, 'experience', input, async ({ tx }, row) => {
    const withCategory = input.items.flatMap((item, i) =>
      item.categoryCode ? [{ code: item.categoryCode, i }] : [],
    );
    if (withCategory.length > 0) {
      await assertActiveMasterData(
        tx,
        'JOB_CATEGORY',
        withCategory.map((c) => c.code),
        (n) => `items.${withCategory[n]!.i}.categoryCode`,
      );
    }
    await tx.delete(exp).where(eq(exp.applicantId, row.id));
    if (input.items.length > 0) {
      await tx.insert(exp).values(
        input.items.map((item, sortOrder) => ({
          ...item,
          startMonth: fromMonth(item.startMonth)!,
          endMonth: fromMonth(item.endMonth),
          applicantId: row.id,
          sortOrder,
        })),
      );
    }
    await tx.update(a).set({ hasNoExperience: input.hasNoExperience }).where(eq(a.id, row.id));
  });
}

export function saveMySkills(ctx: SignedIn, input: SkillsInput) {
  return saveSection(ctx, 'skills', input, async ({ tx }, row) => {
    await assertActiveMasterData(
      tx,
      'SKILL',
      input.items.map((i) => i.skillCode),
      (i) => `items.${i}.skillCode`,
    );
    await tx.delete(skl).where(eq(skl.applicantId, row.id));
    if (input.items.length > 0) {
      await tx.insert(skl).values(input.items.map((item) => ({ ...item, applicantId: row.id })));
    }
  });
}

export function saveMyLanguages(ctx: SignedIn, input: LanguagesInput) {
  return saveSection(ctx, 'languages', input, async ({ tx }, row) => {
    await assertActiveMasterData(
      tx,
      'LANGUAGE',
      input.items.map((i) => i.languageCode),
      (i) => `items.${i}.languageCode`,
    );
    await tx.delete(lng).where(eq(lng.applicantId, row.id));
    if (input.items.length > 0) {
      await tx.insert(lng).values(input.items.map((item) => ({ ...item, applicantId: row.id })));
    }
  });
}

export function saveMyCertifications(ctx: SignedIn, input: CertificationsInput) {
  return saveSection(ctx, 'certifications', input, async ({ tx }, row) => {
    await tx.delete(cert).where(eq(cert.applicantId, row.id));
    if (input.items.length > 0) {
      await tx.insert(cert).values(
        input.items.map((item, sortOrder) => ({
          name: item.name,
          issuer: item.issuer,
          issuedMonth: fromMonth(item.issuedMonth),
          expiresMonth: fromMonth(item.expiresMonth),
          applicantId: row.id,
          sortOrder,
        })),
      );
    }
  });
}

export function saveMyPreferences(ctx: SignedIn, input: PreferencesInput) {
  return saveSection(ctx, 'preferences', input, async ({ tx }, row) => {
    await assertActiveMasterData(
      tx,
      'JOB_CATEGORY',
      input.categoryCodes,
      (i) => `categoryCodes.${i}`,
    );
    if (input.willingRadiusM !== null) {
      // Never wider than the radius the branch matches within (PRD rule 4).
      const { maxM } = await resolveMatchRadius({ branchId: row.branchId });
      if (input.willingRadiusM > maxM) {
        throw new ValidationError([
          {
            path: 'willingRadiusM',
            message: `Your branch matches jobs within ${maxM / 1000} km at most`,
          },
        ]);
      }
    }
    const values = { ...input };
    await tx
      .insert(pref)
      .values({ applicantId: row.id, ...values })
      .onConflictDoUpdate({ target: pref.applicantId, set: values });
  });
}

// ─── Pause / resume ────────────────────────────────────────────────────

/** Applicants pause (INACTIVE: no new matches) or resume their own profile. */
export async function setMyStatus(
  ctx: SignedIn,
  status: 'ACTIVE' | 'INACTIVE',
): Promise<ApplicantProfile> {
  assertPermission(ctx.actor, 'applicant:self');
  const current = await requireOwnApplicant(db, ctx.actor);
  if (current.status === status) return buildProfile(db, current);
  if (current.status === 'DRAFT') {
    throw new ConflictError('Finish setting up your profile first');
  }
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await requireOwnApplicant(tx, ctx.actor, { forUpdate: true });
    const event = status === 'INACTIVE' ? 'DEACTIVATE' : 'REACTIVATE';
    const to = applicantMachine.transition(row.status, event, { activationMissing: [] }, [
      'APPLICANT',
    ]);
    await tx.update(a).set({ status: to, statusReason: null }).where(eq(a.id, row.id));
    audit({
      action: status === 'INACTIVE' ? 'applicant.deactivate' : 'applicant.reactivate',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      metadata: { by: 'applicant' },
    });
  });
  return myProfile(ctx.actor);
}
