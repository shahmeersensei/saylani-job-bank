import 'server-only';
import { schema, type GeoPoint } from '@jobbank/db';
import {
  computeCompleteness,
  missingApplicantDocumentRequirements,
  MASTER_DATA_META,
  type ApplicantDocumentStatus,
  type ApplicantStatus,
  type Completeness,
  type Gender,
  type IdentityStatus,
  type JobType,
  type LanguageProficiency,
  type MasterDataMeta,
  type Shift,
  type SkillLevel,
} from '@jobbank/shared';
import { and, asc, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getBranchContact, type BranchContact } from '@/domains/branch';
import type { CommandScope, RequestContext } from '@/domains/shared/audit';
import { NotFoundError } from '@/domains/shared/errors';
import type { Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';

export type SignedIn = RequestContext & { actor: Actor };

export const a = schema.applicants;
export const addr = schema.applicantAddresses;
export const permAddr = schema.applicantPermanentAddresses;
export const edu = schema.applicantEducation;
export const exp = schema.applicantExperience;
export const skl = schema.applicantSkills;
export const lng = schema.applicantLanguages;
export const cert = schema.applicantCertifications;
export const pref = schema.applicantPreferences;
export const docs = schema.applicantDocuments;
export const idv = schema.identityVerifications;

export { createRegistrationReference } from './registration-reference';

export type ApplicantRow = typeof a.$inferSelect;

/** Document types that prove identity: locked once identity is verified. */
export const IDENTITY_DOCUMENT_TYPES = ['CNIC_FRONT', 'CNIC_BACK'] as const;

/** Documents that count as "present" (uploaded, whatever the review said). */
export const PRESENT_DOCUMENT_STATUSES: ApplicantDocumentStatus[] = [
  'UPLOADED',
  'ACCEPTED',
  'REJECTED',
];

// ─── Views ─────────────────────────────────────────────────────────────

export interface ApplicantDocumentView {
  id: string;
  typeCode: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: ApplicantDocumentStatus;
  /** Staff note when a document was rejected. */
  reviewNote: string | null;
  uploadedAt: string | null;
}

export interface ApplicantProfile {
  id: string;
  registrationReference: string;
  registrationSource: 'SELF_SERVICE' | 'STAFF_ASSISTED';
  registeredAt: string;
  status: ApplicantStatus;
  identityStatus: IdentityStatus;
  /** What staff wrote when the identity check failed (so the applicant can fix it). */
  identityNote: string | null;
  branch: BranchContact | null;
  personal: {
    fullName: string;
    fatherName: string;
    /** 13 digits. Only the applicant and Job Bank staff ever see it. */
    cnic: string;
    dateOfBirth: string;
    gender: Gender;
    email: string | null;
    /** E.164, from the sign-in account. */
    phone: string | null;
  };
  address: {
    addressLine: string;
    cityCode: string;
    areaCode: string | null;
    /** Map pin; null when none was collected (staff registrations since 2026-11-16). */
    location: GeoPoint | null;
  } | null;
  /** Permanent home address (section 5); null when not collected. */
  permanentAddress: {
    addressLine: string;
    cityCode: string;
    areaCode: string | null;
  } | null;
  /** Free-text notes (section 6); null when none were recorded. */
  additionalNotes: string | null;
  education: {
    levelCode: string;
    institution: string | null;
    fieldOfStudy: string | null;
    completionYear: number | null;
    isCurrent: boolean;
    grade: string | null;
  }[];
  experience: {
    employerName: string;
    jobTitle: string;
    categoryCode: string | null;
    /** YYYY-MM */
    startMonth: string;
    endMonth: string | null;
    isCurrent: boolean;
    description: string | null;
  }[];
  hasNoExperience: boolean;
  skills: { skillCode: string; level: SkillLevel; years: number }[];
  languages: { languageCode: string; proficiency: LanguageProficiency }[];
  certifications: {
    name: string;
    issuer: string | null;
    issuedMonth: string | null;
    expiresMonth: string | null;
  }[];
  /** Stable IDs let staff update or explicitly remove records without replacing the lists. */
  recordIds: {
    education: string[];
    experience: string[];
    certifications: string[];
  };
  preferences: {
    categoryCodes: string[];
    minSalaryPkr: number | null;
    shifts: Shift[];
    jobTypes: JobType[];
    availableFrom: string | null;
  } | null;
  /** Current documents (newest first); replaced and unconfirmed uploads are left out. */
  documents: ApplicantDocumentView[];
  completeness: Completeness;
  /** CNIC, names and date of birth are locked once staff verified the identity. */
  identityLocked: boolean;
  /** Only staff can move an activated profile to another branch. */
  branchLocked: boolean;
  /** When the first-counter paper form was verified and signed (null until then). */
  registrationVerifiedSignedAt: string | null;
  /** Who recorded the verified & signed mark (user id, null until then). */
  registrationVerifiedSignedBy: string | null;
  activatedAt: string | null;
  createdAt: string;
}

const toMonth = (value: string | null) => (value ? value.slice(0, 7) : null);
export const fromMonth = (value: string | null) => (value ? `${value}-01` : null);

export const identityLocked = (row: ApplicantRow) => row.identityStatus === 'VERIFIED';
/** Only staff can move a profile to another branch once one is set. */
export const branchLocked = (row: ApplicantRow) => row.branchId !== null;

// ─── Loading ───────────────────────────────────────────────────────────

export async function loadApplicant(
  executor: DbExecutor,
  applicantId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ApplicantRow> {
  const query = executor.select().from(a).where(eq(a.id, applicantId));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Applicant', applicantId);
  return row;
}

export async function findApplicantForUser(
  executor: DbExecutor,
  userId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ApplicantRow | null> {
  const query = executor.select().from(a).where(eq(a.userId, userId));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/** The signed-in applicant's own row, or a 404 telling them to register first. */
export async function requireOwnApplicant(
  executor: DbExecutor,
  actor: Actor,
  options: { forUpdate?: boolean } = {},
): Promise<ApplicantRow> {
  const row = await findApplicantForUser(executor, actor.userId, options);
  if (!row) throw new NotFoundError('Applicant profile');
  return row;
}

export interface ApplicantDocumentType {
  code: string;
  label: string;
  isActive: boolean;
  meta: MasterDataMeta<'DOCUMENT_TYPE'>;
}

/** Document types for applicants (DOCUMENT_TYPE items with meta.appliesTo = APPLICANT). */
export async function applicantDocumentTypes(
  executor: DbExecutor = db,
): Promise<ApplicantDocumentType[]> {
  const rows = await executor
    .select({
      code: schema.masterData.code,
      label: schema.masterData.label,
      isActive: schema.masterData.isActive,
      meta: schema.masterData.meta,
    })
    .from(schema.masterData)
    .where(eq(schema.masterData.type, 'DOCUMENT_TYPE'))
    .orderBy(asc(schema.masterData.sortOrder), asc(schema.masterData.label));
  return rows.flatMap((row) => {
    const meta = MASTER_DATA_META.DOCUMENT_TYPE.safeParse(row.meta);
    return meta.success && meta.data.appliesTo === 'APPLICANT'
      ? [{ code: row.code, label: row.label, isActive: row.isActive, meta: meta.data }]
      : [];
  });
}

export async function currentDocuments(
  executor: DbExecutor,
  applicantId: string,
): Promise<(typeof docs.$inferSelect)[]> {
  return executor
    .select()
    .from(docs)
    .where(
      and(
        eq(docs.applicantId, applicantId),
        isNull(docs.replacedAt),
        inArray(docs.status, PRESENT_DOCUMENT_STATUSES),
      ),
    )
    .orderBy(desc(docs.uploadedAt));
}

export function toDocumentView(row: typeof docs.$inferSelect): ApplicantDocumentView {
  return {
    id: row.id,
    typeCode: row.typeCode,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    reviewNote: row.reviewNote,
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
  };
}

// ─── Completeness & activation ─────────────────────────────────────────

export async function completenessFor(
  executor: DbExecutor,
  row: ApplicantRow,
  preloaded?: CompletenessPreload,
): Promise<Completeness> {
  const inputs = preloaded ?? (await loadCompletenessInputs(executor, row));
  const applicantCategories = new Set(inputs.preferenceCategories);
  // Audit 2026-11-10 (A-H2): a REJECTED document must not satisfy
  // completeness — a profile whose only CNIC evidence was rejected could
  // otherwise REACTIVATE. REJECTED docs stay visible in currentDocuments
  // (staff/applicant can still view the rejection), they just no longer
  // count as "present" for the completeness guard.
  const presentTypes = new Set(
    inputs.presentDocuments.filter((d) => d.status !== 'REJECTED').map((d) => d.typeCode),
  );
  const missingRequiredDocuments = missingApplicantDocumentRequirements(
    inputs.documentTypes.filter((t) => t.isActive).map((t) => ({ code: t.code, ...t.meta })),
    applicantCategories,
    presentTypes,
  );

  return computeCompleteness({
    hasPersonal: true,
    hasLocation: inputs.hasAddress && row.branchId !== null,
    skillCount: inputs.skillCount,
    educationCount: inputs.educationCount,
    experienceCount: inputs.experienceCount,
    hasNoExperience: row.hasNoExperience,
    hasPreferences: inputs.preferenceCategories.length > 0,
    missingRequiredDocuments,
    languageCount: inputs.languageCount,
  });
}

/**
 * Inputs completeness needs, already fetched by the caller (buildProfile loads
 * every one of these rows anyway). Pass them in to avoid re-querying; when
 * omitted, completenessFor fetches them itself (refreshProfileState, REACTIVATE).
 */
export interface CompletenessPreload {
  hasAddress: boolean;
  preferenceCategories: string[];
  educationCount: number;
  experienceCount: number;
  skillCount: number;
  languageCount: number;
  documentTypes: ApplicantDocumentType[];
  presentDocuments: (typeof docs.$inferSelect)[];
}

async function loadCompletenessInputs(
  executor: DbExecutor,
  row: ApplicantRow,
): Promise<CompletenessPreload> {
  const countOf = async (table: typeof edu | typeof exp | typeof skl | typeof lng) =>
    (await executor.select({ n: count() }).from(table).where(eq(table.applicantId, row.id)))[0]
      ?.n ?? 0;
  const [address, preferences, educationCount, experienceCount, skillCount, languageCount] =
    await Promise.all([
      executor.select({ id: addr.applicantId }).from(addr).where(eq(addr.applicantId, row.id)),
      executor
        .select({ categories: pref.categoryCodes })
        .from(pref)
        .where(eq(pref.applicantId, row.id)),
      countOf(edu),
      countOf(exp),
      countOf(skl),
      countOf(lng),
    ]);
  const [types, present] = await Promise.all([
    applicantDocumentTypes(executor),
    currentDocuments(executor, row.id),
  ]);
  return {
    hasAddress: address.length > 0,
    preferenceCategories: preferences[0]?.categories ?? [],
    educationCount,
    experienceCount,
    skillCount,
    languageCount,
    documentTypes: types,
    presentDocuments: present,
  };
}

/**
 * Re-computes completeness after a change and stores the percent. Profiles
 * are ACTIVE from creation (the DRAFT status was removed 2026-11-09), so
 * there is no activation or demotion here any more: losing a location or a
 * required document only lowers the completeness percent. Call at the end
 * of every command that changes the profile.
 */
export async function refreshProfileState(
  cmd: CommandScope,
  applicantId: string,
): Promise<{ status: ApplicantStatus; completeness: Completeness }> {
  const { tx } = cmd;
  const row = await loadApplicant(tx, applicantId);
  const completeness = await completenessFor(tx, row);
  if (completeness.percent !== row.profileCompleteness) {
    await tx.update(a).set({ profileCompleteness: completeness.percent }).where(eq(a.id, row.id));
  }
  return { status: row.status, completeness };
}

// ─── Full profile ──────────────────────────────────────────────────────

/**
 * Full profile view. Query budget: 13 selects (12 sections + the DOCUMENT_TYPE
 * master-data list) plus the caller's row load — the completeness inputs are
 * the rows already fetched here, passed in so completenessFor does not
 * re-query them (it used to add 8 more: address, preferences, 4 counts and a
 * second copy of the documents). Callers that only need completeness
 * (refreshProfileState, REACTIVATE) call completenessFor directly and it
 * fetches what it needs.
 */
export async function buildProfile(
  executor: DbExecutor,
  row: ApplicantRow,
): Promise<ApplicantProfile> {
  const [
    [user],
    [address],
    [permanentAddress],
    education,
    experience,
    skills,
    languages,
    certifications,
    [preferences],
    documents,
    [lastCheck],
    branch,
    documentTypes,
  ] = await Promise.all([
    executor
      .select({ phone: schema.users.phoneNumber })
      .from(schema.users)
      .where(eq(schema.users.id, row.userId)),
    executor.select().from(addr).where(eq(addr.applicantId, row.id)),
    executor.select().from(permAddr).where(eq(permAddr.applicantId, row.id)),
    executor.select().from(edu).where(eq(edu.applicantId, row.id)).orderBy(asc(edu.sortOrder)),
    executor.select().from(exp).where(eq(exp.applicantId, row.id)).orderBy(asc(exp.sortOrder)),
    executor.select().from(skl).where(eq(skl.applicantId, row.id)).orderBy(asc(skl.skillCode)),
    executor.select().from(lng).where(eq(lng.applicantId, row.id)).orderBy(asc(lng.languageCode)),
    executor.select().from(cert).where(eq(cert.applicantId, row.id)).orderBy(asc(cert.sortOrder)),
    executor.select().from(pref).where(eq(pref.applicantId, row.id)),
    currentDocuments(executor, row.id),
    executor
      .select({ outcome: idv.outcome, notes: idv.notes })
      .from(idv)
      .where(eq(idv.applicantId, row.id))
      .orderBy(desc(idv.createdAt))
      .limit(1),
    row.branchId ? getBranchContact(row.branchId, executor) : Promise.resolve(null),
    applicantDocumentTypes(executor),
  ]);
  const completeness = await completenessFor(executor, row, {
    hasAddress: address !== undefined,
    preferenceCategories: preferences?.categoryCodes ?? [],
    educationCount: education.length,
    experienceCount: experience.length,
    skillCount: skills.length,
    languageCount: languages.length,
    documentTypes,
    presentDocuments: documents,
  });

  return {
    id: row.id,
    registrationReference: row.registrationReference,
    registrationSource: row.registrationSource,
    registeredAt: row.registeredAt.toISOString(),
    status: row.status,
    identityStatus: row.identityStatus,
    identityNote:
      row.identityStatus === 'REJECTED' && lastCheck?.outcome === 'REJECTED'
        ? lastCheck.notes
        : null,
    branch,
    personal: {
      fullName: row.fullName,
      fatherName: row.fatherName,
      cnic: row.cnic,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      email: row.email,
      phone: user?.phone ?? null,
    },
    address: address
      ? {
          addressLine: address.addressLine,
          cityCode: address.cityCode,
          areaCode: address.areaCode,
          location: address.location,
        }
      : null,
    permanentAddress: permanentAddress
      ? {
          addressLine: permanentAddress.addressLine,
          cityCode: permanentAddress.cityCode,
          areaCode: permanentAddress.areaCode,
        }
      : null,
    additionalNotes: row.additionalNotes,
    education: education.map((e) => ({
      levelCode: e.levelCode,
      institution: e.institution,
      fieldOfStudy: e.fieldOfStudy,
      completionYear: e.completionYear,
      isCurrent: e.isCurrent,
      grade: e.grade,
    })),
    experience: experience.map((e) => ({
      employerName: e.employerName,
      jobTitle: e.jobTitle,
      categoryCode: e.categoryCode,
      startMonth: toMonth(e.startMonth)!,
      endMonth: toMonth(e.endMonth),
      isCurrent: e.isCurrent,
      description: e.description,
    })),
    hasNoExperience: row.hasNoExperience,
    skills: skills.map((s) => ({ skillCode: s.skillCode, level: s.level, years: s.years })),
    languages: languages.map((l) => ({
      languageCode: l.languageCode,
      proficiency: l.proficiency,
    })),
    certifications: certifications.map((c) => ({
      name: c.name,
      issuer: c.issuer,
      issuedMonth: toMonth(c.issuedMonth),
      expiresMonth: toMonth(c.expiresMonth),
    })),
    recordIds: {
      education: education.map((e) => e.id),
      experience: experience.map((e) => e.id),
      certifications: certifications.map((c) => c.id),
    },
    preferences: preferences
      ? {
          categoryCodes: preferences.categoryCodes,
          minSalaryPkr: preferences.minSalaryPkr,
          shifts: preferences.shifts as Shift[],
          jobTypes: preferences.jobTypes as JobType[],
          availableFrom: preferences.availableFrom,
        }
      : null,
    documents: documents.map(toDocumentView),
    completeness,
    identityLocked: identityLocked(row),
    branchLocked: branchLocked(row),
    registrationVerifiedSignedAt: row.registrationVerifiedSignedAt?.toISOString() ?? null,
    registrationVerifiedSignedBy: row.registrationVerifiedSignedBy,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Another applicant already holds this CNIC (excluding `exceptId`). */
export async function cnicOwner(
  executor: DbExecutor,
  cnic: string,
  exceptId?: string,
): Promise<ApplicantRow | null> {
  const [row] = await executor
    .select()
    .from(a)
    .where(and(eq(a.cnic, cnic), exceptId ? ne(a.id, exceptId) : undefined));
  return row ?? null;
}
