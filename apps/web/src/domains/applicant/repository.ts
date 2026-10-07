import 'server-only';
import { schema, type GeoPoint } from '@jobbank/db';
import {
  computeCompleteness,
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
import { applicantMachine } from './machine';

export type SignedIn = RequestContext & { actor: Actor };

export const a = schema.applicants;
export const addr = schema.applicantAddresses;
export const edu = schema.applicantEducation;
export const exp = schema.applicantExperience;
export const skl = schema.applicantSkills;
export const lng = schema.applicantLanguages;
export const cert = schema.applicantCertifications;
export const pref = schema.applicantPreferences;
export const docs = schema.applicantDocuments;
export const idv = schema.identityVerifications;

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
    location: GeoPoint;
  } | null;
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
  preferences: {
    categoryCodes: string[];
    minSalaryPkr: number | null;
    shifts: Shift[];
    jobTypes: JobType[];
    willingRadiusM: number | null;
    availableFrom: string | null;
  } | null;
  /** Current documents (newest first); replaced and unconfirmed uploads are left out. */
  documents: ApplicantDocumentView[];
  completeness: Completeness;
  /** CNIC, names and date of birth are locked once staff verified the identity. */
  identityLocked: boolean;
  /** Only staff can move an activated profile to another branch. */
  branchLocked: boolean;
  activatedAt: string | null;
  createdAt: string;
}

const toMonth = (value: string | null) => (value ? value.slice(0, 7) : null);
export const fromMonth = (value: string | null) => (value ? `${value}-01` : null);

export const identityLocked = (row: ApplicantRow) => row.identityStatus === 'VERIFIED';
export const branchLocked = (row: ApplicantRow) => row.status !== 'DRAFT';

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
): Promise<Completeness> {
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
  const presentTypes = new Set(present.map((d) => d.typeCode));
  const missingRequiredDocuments = types.filter(
    (t) => t.isActive && t.meta.required && !presentTypes.has(t.code),
  ).length;

  return computeCompleteness({
    hasPersonal: true,
    hasLocation: address.length > 0 && row.branchId !== null,
    skillCount,
    educationCount,
    experienceCount,
    hasNoExperience: row.hasNoExperience,
    hasPreferences: (preferences[0]?.categories.length ?? 0) > 0,
    missingRequiredDocuments,
    languageCount,
  });
}

/**
 * Re-computes completeness after a change and activates a DRAFT profile as soon as the
 * activation requirements are met (owner decision: automatic, no staff step). Call at the
 * end of every command that changes the profile.
 */
export async function refreshProfileState(
  cmd: CommandScope,
  applicantId: string,
): Promise<{ status: ApplicantStatus; completeness: Completeness }> {
  const { tx, audit, emit } = cmd;
  const row = await loadApplicant(tx, applicantId);
  const completeness = await completenessFor(tx, row);
  const changes: Partial<typeof a.$inferInsert> = {};
  if (completeness.percent !== row.profileCompleteness) {
    changes.profileCompleteness = completeness.percent;
  }
  let status = row.status;
  const activation = applicantMachine.check(
    row.status,
    'ACTIVATE',
    { activationMissing: completeness.activationMissing },
    'system',
  );
  if (activation.ok) {
    status = activation.to;
    changes.status = status;
    changes.activatedAt = new Date();
    audit({
      action: 'applicant.activate',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status },
    });
    emit('applicant.activated', { applicantId: row.id, branchId: row.branchId! });
  }
  if (Object.keys(changes).length > 0) await tx.update(a).set(changes).where(eq(a.id, row.id));
  return { status, completeness };
}

// ─── Full profile ──────────────────────────────────────────────────────

export async function buildProfile(
  executor: DbExecutor,
  row: ApplicantRow,
): Promise<ApplicantProfile> {
  const [
    [user],
    [address],
    education,
    experience,
    skills,
    languages,
    certifications,
    [preferences],
    documents,
    [lastCheck],
    branch,
    completeness,
  ] = await Promise.all([
    executor
      .select({ phone: schema.users.phoneNumber })
      .from(schema.users)
      .where(eq(schema.users.id, row.userId)),
    executor.select().from(addr).where(eq(addr.applicantId, row.id)),
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
    completenessFor(executor, row),
  ]);

  return {
    id: row.id,
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
    preferences: preferences
      ? {
          categoryCodes: preferences.categoryCodes,
          minSalaryPkr: preferences.minSalaryPkr,
          shifts: preferences.shifts as Shift[],
          jobTypes: preferences.jobTypes as JobType[],
          willingRadiusM: preferences.willingRadiusM,
          availableFrom: preferences.availableFrom,
        }
      : null,
    documents: documents.map(toDocumentView),
    completeness,
    identityLocked: identityLocked(row),
    branchLocked: branchLocked(row),
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
