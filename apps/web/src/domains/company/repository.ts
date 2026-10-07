import 'server-only';
import { schema, type GeoPoint } from '@jobbank/db';
import {
  MASTER_DATA_META,
  OPEN_VERIFICATION_STATES,
  type CompanyLocationKind,
  type CompanySizeBand,
  type CompanyStatus,
  type VerificationEvent,
  type DocumentReviewStatus,
  type LegalStructure,
  type MasterDataMeta,
  type VerificationState,
} from '@jobbank/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getBranchContact, type BranchContact } from '@/domains/branch';
import {
  assertActiveMasterData,
  getSetting,
  getWorkingCalendar,
  pktDate,
  slaDueDate,
} from '@/domains/settings';
import type { RequestContext } from '@/domains/shared/audit';
import { NotFoundError, ValidationError } from '@/domains/shared/errors';
import type { Actor } from '@/domains/shared/scope';
import { db, type DbExecutor, type Transaction } from '@/lib/db';
import { companyEditability, slaStatus, type CompanyEditability, type SlaStatus } from './rules';

export type SignedIn = RequestContext & { actor: Actor };

export const c = schema.companies;
export const members = schema.companyMembers;
export const contacts = schema.companyContacts;
export const locs = schema.companyLocations;
export const docs = schema.companyDocuments;
export const reqs = schema.companyDocumentRequirements;
export const ver = schema.companyVerifications;
export const hist = schema.verificationHistory;

export type CompanyRow = typeof c.$inferSelect;
export type VerificationRow = typeof ver.$inferSelect;
export type CompanyDocumentRow = typeof docs.$inferSelect;

// ─── Views ─────────────────────────────────────────────────────────────

export interface CompanyDocumentView {
  id: string;
  typeCode: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  reviewStatus: DocumentReviewStatus;
  /** The verifier's note when a document was not accepted. */
  reviewNote: string | null;
  uploadedAt: string | null;
}

export interface CompanyLocationView {
  id: string;
  kind: CompanyLocationKind;
  label: string;
  addressLine: string;
  cityCode: string;
  areaCode: string | null;
  location: GeoPoint;
}

export interface CompanyContactView {
  name: string;
  designation: string | null;
  /** E.164. */
  phone: string;
  email: string | null;
  isPrimary: boolean;
}

export interface VerificationSummary {
  id: string;
  round: number;
  state: VerificationState;
  submittedAt: string;
  clockStartedAt: string;
  /** Pakistan calendar date the verifier should decide by. */
  slaDueOn: string;
  sla: SlaStatus;
  infoRequest: string | null;
  infoRequestedAt: string | null;
  employerNote: string | null;
  decidedAt: string | null;
  rejectionReasonCode: string | null;
  decisionNote: string | null;
}

export interface CompanyView {
  id: string;
  status: CompanyStatus;
  branch: BranchContact | null;
  details: {
    legalName: string;
    tradeName: string | null;
    legalStructure: LegalStructure;
    ntn: string;
    registrationNo: string | null;
    industryCode: string;
    sizeBand: CompanySizeBand;
    website: string | null;
    description: string | null;
  };
  contacts: CompanyContactView[];
  headOffice: CompanyLocationView | null;
  sites: CompanyLocationView[];
  /** Current documents (newest first); replaced and unconfirmed uploads are left out. */
  documents: CompanyDocumentView[];
  /** Document type codes this legal structure must upload. */
  requiredDocuments: string[];
  /** What still blocks (re)submission, in plain words (empty = ready). */
  missing: string[];
  /** Latest verification round (open or decided). */
  verification: VerificationSummary | null;
  editable: CompanyEditability;
  verifiedAt: string | null;
  createdAt: string;
}

// ─── Loading ───────────────────────────────────────────────────────────

export async function loadCompany(
  executor: DbExecutor,
  companyId: string,
  options: { forUpdate?: boolean } = {},
): Promise<CompanyRow> {
  const query = executor.select().from(c).where(eq(c.id, companyId));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Company', companyId);
  return row;
}

export async function findCompanyForUser(
  executor: DbExecutor,
  userId: string,
  options: { forUpdate?: boolean } = {},
): Promise<CompanyRow | null> {
  const [member] = await executor
    .select({ companyId: members.companyId })
    .from(members)
    .where(eq(members.userId, userId));
  return member ? loadCompany(executor, member.companyId, options) : null;
}

/** The signed-in employer's company, or a 404 telling them to register it first. */
export async function requireOwnCompany(
  executor: DbExecutor,
  actor: Actor,
  options: { forUpdate?: boolean } = {},
): Promise<CompanyRow> {
  const row = await findCompanyForUser(executor, actor.userId, options);
  if (!row) throw new NotFoundError('Company profile');
  return row;
}

export interface CompanyDocumentType {
  code: string;
  label: string;
  isActive: boolean;
  meta: MasterDataMeta<'DOCUMENT_TYPE'>;
}

/** DOCUMENT_TYPE items with meta.appliesTo = COMPANY. */
export async function companyDocumentTypes(
  executor: DbExecutor = db,
): Promise<CompanyDocumentType[]> {
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
    return meta.success && meta.data.appliesTo === 'COMPANY'
      ? [{ code: row.code, label: row.label, isActive: row.isActive, meta: meta.data }]
      : [];
  });
}

/** Required (and still active) company document types for a legal structure. */
export async function requiredDocumentTypes(
  executor: DbExecutor,
  structure: LegalStructure,
): Promise<CompanyDocumentType[]> {
  const [types, rows] = await Promise.all([
    companyDocumentTypes(executor),
    executor
      .select({ code: reqs.documentTypeCode })
      .from(reqs)
      .where(eq(reqs.legalStructure, structure)),
  ]);
  const required = new Set(rows.map((r) => r.code));
  return types.filter((t) => t.isActive && required.has(t.code));
}

export async function currentDocuments(
  executor: DbExecutor,
  companyId: string,
): Promise<CompanyDocumentRow[]> {
  return executor
    .select()
    .from(docs)
    .where(and(eq(docs.companyId, companyId), isNull(docs.replacedAt), eq(docs.status, 'UPLOADED')))
    .orderBy(desc(docs.uploadedAt));
}

export function toDocumentView(row: CompanyDocumentRow): CompanyDocumentView {
  return {
    id: row.id,
    typeCode: row.typeCode,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    reviewStatus: row.reviewStatus,
    reviewNote: row.reviewNote,
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
  };
}

const toLocationView = (row: typeof locs.$inferSelect): CompanyLocationView => ({
  id: row.id,
  kind: row.kind,
  label: row.label,
  addressLine: row.addressLine,
  cityCode: row.cityCode,
  areaCode: row.areaCode,
  location: row.location,
});

export async function latestVerification(
  executor: DbExecutor,
  companyId: string,
): Promise<VerificationRow | null> {
  const [row] = await executor
    .select()
    .from(ver)
    .where(eq(ver.companyId, companyId))
    .orderBy(desc(ver.round))
    .limit(1);
  return row ?? null;
}

export async function openVerification(
  executor: DbExecutor,
  companyId: string,
  options: { forUpdate?: boolean } = {},
): Promise<VerificationRow | null> {
  const query = executor
    .select()
    .from(ver)
    .where(and(eq(ver.companyId, companyId), inArray(ver.state, [...OPEN_VERIFICATION_STATES])));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export function toVerificationSummary(row: VerificationRow, now = new Date()): VerificationSummary {
  return {
    id: row.id,
    round: row.round,
    state: row.state,
    submittedAt: row.submittedAt.toISOString(),
    clockStartedAt: row.clockStartedAt.toISOString(),
    slaDueOn: row.slaDueOn,
    sla: slaStatus(row.state, row.slaDueOn, pktDate(now)),
    infoRequest: row.infoRequest,
    infoRequestedAt: row.infoRequestedAt?.toISOString() ?? null,
    employerNote: row.employerNote,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReasonCode: row.rejectionReasonCode,
    decisionNote: row.decisionNote,
  };
}

// ─── Readiness ─────────────────────────────────────────────────────────

/**
 * What still blocks submission: a main contact, the head office + branch, and every required
 * document for the legal structure (a document the verifier rejected must be replaced).
 */
export async function submissionMissing(executor: DbExecutor, row: CompanyRow): Promise<string[]> {
  const [contactRows, [hq], required, current] = await Promise.all([
    executor
      .select({ isPrimary: contacts.isPrimary })
      .from(contacts)
      .where(eq(contacts.companyId, row.id)),
    executor
      .select({ id: locs.id })
      .from(locs)
      .where(and(eq(locs.companyId, row.id), eq(locs.kind, 'HQ'))),
    requiredDocumentTypes(executor, row.legalStructure),
    currentDocuments(executor, row.id),
  ]);
  const missing: string[] = [];
  if (!contactRows.some((r) => r.isPrimary)) missing.push('a main contact person');
  if (!hq || !row.branchId) missing.push('the head office location and branch');
  for (const type of required) {
    const present = current.filter((d) => d.typeCode === type.code);
    if (present.length === 0) missing.push(type.label);
    else if (present.every((d) => d.reviewStatus === 'REJECTED')) {
      missing.push(`a new ${type.label} (the last one was not accepted)`);
    }
  }
  return missing;
}

/** Required documents without an accepted current upload (labels), for the VERIFY guard. */
export async function documentsNotAccepted(
  executor: DbExecutor,
  row: CompanyRow,
): Promise<string[]> {
  const [required, current] = await Promise.all([
    requiredDocumentTypes(executor, row.legalStructure),
    currentDocuments(executor, row.id),
  ]);
  return required
    .filter(
      (type) => !current.some((d) => d.typeCode === type.code && d.reviewStatus === 'ACCEPTED'),
    )
    .map((type) => type.label);
}

// ─── Full view ─────────────────────────────────────────────────────────

export async function buildCompanyView(
  executor: DbExecutor,
  row: CompanyRow,
): Promise<CompanyView> {
  const [contactRows, locationRows, documents, required, latest, branch, missing] =
    await Promise.all([
      executor
        .select()
        .from(contacts)
        .where(eq(contacts.companyId, row.id))
        .orderBy(desc(contacts.isPrimary), asc(contacts.sortOrder)),
      executor
        .select()
        .from(locs)
        .where(and(eq(locs.companyId, row.id), isNull(locs.archivedAt)))
        .orderBy(asc(locs.createdAt)),
      currentDocuments(executor, row.id),
      requiredDocumentTypes(executor, row.legalStructure),
      latestVerification(executor, row.id),
      row.branchId ? getBranchContact(row.branchId, executor) : Promise.resolve(null),
      submissionMissing(executor, row),
    ]);
  const hq = locationRows.find((l) => l.kind === 'HQ');
  return {
    id: row.id,
    status: row.status,
    branch,
    details: {
      legalName: row.legalName,
      tradeName: row.tradeName,
      legalStructure: row.legalStructure,
      ntn: row.ntn,
      registrationNo: row.registrationNo,
      industryCode: row.industryCode,
      sizeBand: row.sizeBand,
      website: row.website,
      description: row.description,
    },
    contacts: contactRows.map((r) => ({
      name: r.name,
      designation: r.designation,
      phone: r.phone,
      email: r.email,
      isPrimary: r.isPrimary,
    })),
    headOffice: hq ? toLocationView(hq) : null,
    sites: locationRows.filter((l) => l.kind === 'SITE').map(toLocationView),
    documents: documents.map(toDocumentView),
    requiredDocuments: required.map((t) => t.code),
    missing,
    verification: latest ? toVerificationSummary(latest) : null,
    editable: companyEditability(row.status),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── Shared write helpers ──────────────────────────────────────────────

/** City + optional area (which must be in that city), both active. */
export async function assertCityArea(
  executor: DbExecutor,
  input: { cityCode: string; areaCode: string | null },
): Promise<void> {
  const city = (
    await assertActiveMasterData(executor, 'CITY', [input.cityCode], () => 'cityCode')
  ).get(input.cityCode)!;
  if (!input.areaCode) return;
  const area = (
    await assertActiveMasterData(executor, 'AREA', [input.areaCode], () => 'areaCode')
  ).get(input.areaCode)!;
  if (area.parentId !== city.id) {
    throw new ValidationError([{ path: 'areaCode', message: `This area is not in ${city.label}` }]);
  }
}

/** SLA due date for a round whose clock starts at `from` (owner decision 8). */
export async function verificationDueOn(from: Date): Promise<string> {
  const [days, calendar] = await Promise.all([
    getSetting('verification.sla_working_days'),
    getWorkingCalendar(),
  ]);
  return slaDueDate(from, days, calendar);
}

/** Appends one row to the append-only verification history. */
export async function recordTransition(
  tx: Transaction,
  entry: {
    verificationId: string;
    companyId: string;
    event: VerificationEvent;
    fromStatus: CompanyStatus | null;
    toStatus: CompanyStatus;
    actorId: string | null;
    note?: string | null;
    reasonCode?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(hist).values({
    verificationId: entry.verificationId,
    companyId: entry.companyId,
    event: entry.event,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    actorId: entry.actorId,
    note: entry.note ?? null,
    reasonCode: entry.reasonCode ?? null,
    metadata: entry.metadata ?? null,
  });
}
