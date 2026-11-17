import 'server-only';
import type { GeoPoint } from '@jobbank/db';
import {
  COMPANY_LEGAL_FIELDS,
  isResubmitNoteSufficient,
  type CompanyContactsInput,
  type CompanyHeadOfficeInput,
  type CompanySiteInput,
  type RegisterCompanyInput,
  type UpdateCompanyInput,
} from '@jobbank/shared';
import { and, eq, inArray, max, ne, notInArray } from 'drizzle-orm';
import { getBranchContact, listBranchOptions, type BranchOption } from '@/domains/branch';
import { assertActiveMasterData, getWorkingCalendar, slaDueDate } from '@/domains/settings';
import { runCommand } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '@/domains/shared/errors';
import { assertPermission, type Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';
import { formatDate } from '@/lib/format/date';
import { companySubmittedEmail } from '@/lib/mail/templates';
import { companyMachine } from './machine';
import { emailEmployers } from './notify';
import {
  assertCityArea,
  buildCompanyView,
  c,
  changedSinceInfoRequest,
  contacts,
  findCompanyForUser,
  loadCompany,
  locs,
  members,
  openVerification,
  recordTransition,
  requireOwnCompany,
  submissionMissing,
  ver,
  verificationDueOn,
  type CompanyRow,
  type CompanyView,
  type SignedIn,
} from './repository';
import { companyEditability } from './rules';

const ACTIVE_NTN_CONSTRAINT = 'companies_ntn_active_uq';

const ntnTaken = () =>
  new ConflictError(
    'A company with this NTN is already registered with Saylani Job Bank. If it is yours, please contact your nearest Job Bank branch.',
    { reason: 'NTN_TAKEN' },
  );

/** Another live (submitted or verified) company already holds this NTN. */
async function assertNtnFree(executor: DbExecutor, ntn: string, exceptId?: string) {
  const [other] = await executor
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.ntn, ntn),
        notInArray(c.status, ['DRAFT', 'REJECTED']),
        exceptId ? ne(c.id, exceptId) : undefined,
      ),
    );
  if (other) throw ntnTaken();
}

// ─── Reads ─────────────────────────────────────────────────────────────

/** The signed-in employer's company, or null before they register it. */
export async function getMyCompany(actor: Actor): Promise<CompanyView | null> {
  assertPermission(actor, 'company:register');
  const row = await findCompanyForUser(db, actor.userId);
  return row ? buildCompanyView(db, row) : null;
}

async function myCompany(actor: Actor): Promise<CompanyView> {
  return buildCompanyView(db, await requireOwnCompany(db, actor));
}

/** Active branches nearest-first from the head office pin; the first is the suggestion. */
export async function myCompanyBranchOptions(
  actor: Actor,
  point: GeoPoint,
): Promise<BranchOption[]> {
  assertPermission(actor, 'company:register');
  return listBranchOptions(point);
}

// ─── Registration & details ────────────────────────────────────────────

/** First wizard step: creates the DRAFT company and links the employer account to it. */
export async function registerCompany(
  ctx: SignedIn,
  input: RegisterCompanyInput,
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  let createdId = '';
  try {
    createdId = await runCommand(ctx, async ({ tx, audit }) => {
      // One employer account holds one company; a second registration is
      // refused with the same ALREADY_REGISTERED conflict as before.
      const existing = await findCompanyForUser(tx, ctx.actor.userId);
      if (existing) {
        throw new ConflictError(
          'You already have a registered company. To register another company, use a different email address.',
          { reason: 'ALREADY_REGISTERED' },
        );
      }
      await assertActiveMasterData(tx, 'INDUSTRY', [input.industryCode], () => 'industryCode');
      await assertNtnFree(tx, input.ntn);
      const [row] = await tx
        .insert(c)
        .values({ ...input, createdBy: ctx.actor.userId })
        .returning();
      await tx.insert(members).values({ companyId: row!.id, userId: ctx.actor.userId });
      audit({
        action: 'company.register',
        entityType: 'company',
        entityId: row!.id,
        after: input,
      });
      return row!.id;
    });
  } catch (error) {
    // A concurrent duplicate NTN hits the active-NTN unique index (L12): report
    // it as NTN_TAKEN, not a generic 409.
    if (isUniqueViolation(error, ACTIVE_NTN_CONSTRAINT)) throw ntnTaken();
    throw error;
  }
  // Return the company just created.
  return buildCompanyView(db, await loadCompany(db, createdId));
}

const LEGAL = new Set<string>(COMPANY_LEGAL_FIELDS);

function readOnlyError(row: CompanyRow, what: string) {
  if (row.status === 'VERIFIED') {
    return new ForbiddenError(
      `Your company is verified, so ${what} can no longer be changed here. Please contact your Job Bank branch.`,
    );
  }
  if (row.status === 'SUSPENDED') {
    return new ForbiddenError('Your company is suspended. Please contact your Job Bank branch.');
  }
  return new ForbiddenError(
    'Your registration is with a verifier now. You can make changes if they ask for more information.',
  );
}

export async function updateMyCompany(
  ctx: SignedIn,
  input: UpdateCompanyInput,
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  try {
    await runCommand(
      ctx,
      async ({ tx, audit }) => {
        const row = await requireOwnCompany(tx, ctx.actor, { forUpdate: true });
        const changes = Object.fromEntries(
          Object.entries(input).filter(
            ([key, value]) => value !== undefined && value !== row[key as keyof CompanyRow],
          ),
        ) as UpdateCompanyInput;
        if (Object.keys(changes).length === 0) return; // valid no-op; audited:false below
        const editable = companyEditability(row.status);
        const touchesLegal = Object.keys(changes).some((key) => LEGAL.has(key));
        if (touchesLegal && !editable.legal) throw readOnlyError(row, 'its legal details');
        if (!editable.details) throw readOnlyError(row, 'its details');
        if (changes.industryCode) {
          await assertActiveMasterData(
            tx,
            'INDUSTRY',
            [changes.industryCode],
            () => 'industryCode',
          );
        }
        if (changes.ntn) await assertNtnFree(tx, changes.ntn, row.id);
        await tx.update(c).set(changes).where(eq(c.id, row.id));
        audit({
          action: 'company.update',
          entityType: 'company',
          entityId: row.id,
          branchId: row.branchId,
          before: Object.fromEntries(
            Object.keys(changes).map((k) => [k, row[k as keyof CompanyRow]]),
          ),
          after: changes,
        });
      },
      { audited: false },
    );
  } catch (error) {
    if (isUniqueViolation(error, ACTIVE_NTN_CONSTRAINT)) throw ntnTaken();
    throw error;
  }
  return myCompany(ctx.actor);
}

// ─── Contacts ──────────────────────────────────────────────────────────

/** Saves the whole contact list (1–5 people, exactly one main contact). */
export async function saveMyContacts(
  ctx: SignedIn,
  input: CompanyContactsInput,
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await requireOwnCompany(tx, ctx.actor, { forUpdate: true });
    if (!companyEditability(row.status).contacts) throw readOnlyError(row, 'contacts');
    await tx.delete(contacts).where(eq(contacts.companyId, row.id));
    await tx
      .insert(contacts)
      .values(input.items.map((item, sortOrder) => ({ ...item, companyId: row.id, sortOrder })));
    audit({
      action: 'company.update_contacts',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      after: input,
    });
  });
  return myCompany(ctx.actor);
}

// ─── Head office, branch & sites ───────────────────────────────────────

export async function setMyHeadOffice(
  ctx: SignedIn,
  input: CompanyHeadOfficeInput,
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await requireOwnCompany(tx, ctx.actor, { forUpdate: true });
    const editable = companyEditability(row.status);
    if (!editable.locations) throw readOnlyError(row, 'its locations');
    const branchChanged = row.branchId !== input.branchId;
    if (branchChanged && !editable.branch) {
      throw new ForbiddenError(
        'Your company has been submitted, so only Job Bank can move it to another branch. Please contact your branch.',
      );
    }
    const branch = await getBranchContact(input.branchId, tx);
    if (!branch?.isActive) {
      throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
    }
    // H12: the city must be an active CITY and the area (if given) must belong to it,
    // mirroring setMyLocation on the applicant side.
    await assertCityArea(tx, input);
    const values = {
      label: 'Head office',
      addressLine: input.addressLine,
      cityCode: input.cityCode,
      areaCode: input.areaCode,
      location: input.location,
    };
    const [hq] = await tx
      .select({ id: locs.id })
      .from(locs)
      .where(and(eq(locs.companyId, row.id), eq(locs.kind, 'HQ')));
    if (hq) await tx.update(locs).set(values).where(eq(locs.id, hq.id));
    else await tx.insert(locs).values({ ...values, companyId: row.id, kind: 'HQ' });
    if (branchChanged) await tx.update(c).set({ branchId: input.branchId }).where(eq(c.id, row.id));
    audit({
      action: 'company.update_head_office',
      entityType: 'company',
      entityId: row.id,
      branchId: input.branchId,
      after: { ...values, branchId: input.branchId },
      metadata: { branchChanged },
    });
  });
  return myCompany(ctx.actor);
}

async function ownSite(executor: DbExecutor, row: CompanyRow, siteId: string) {
  const [site] = await executor
    .select()
    .from(locs)
    .where(and(eq(locs.id, siteId), eq(locs.companyId, row.id), eq(locs.kind, 'SITE')));
  if (!site || site.archivedAt) throw new NotFoundError('Site', siteId);
  return site;
}

const MAX_SITES = 20;

export async function addMySite(ctx: SignedIn, input: CompanySiteInput): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await requireOwnCompany(tx, ctx.actor, { forUpdate: true });
    if (!companyEditability(row.status).locations) throw readOnlyError(row, 'its locations');
    // H12: see setMyHeadOffice.
    await assertCityArea(tx, input);
    const existing = await tx
      .select({ id: locs.id, archivedAt: locs.archivedAt })
      .from(locs)
      .where(and(eq(locs.companyId, row.id), eq(locs.kind, 'SITE')));
    if (existing.filter((s) => !s.archivedAt).length >= MAX_SITES) {
      throw new ConflictError(`A company can list up to ${MAX_SITES} work sites`);
    }
    const [site] = await tx
      .insert(locs)
      .values({ ...input, companyId: row.id, kind: 'SITE' })
      .returning({ id: locs.id });
    audit({
      action: 'company.add_site',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      after: input,
      metadata: { siteId: site!.id },
    });
  });
  return myCompany(ctx.actor);
}

export async function updateMySite(
  ctx: SignedIn,
  siteId: string,
  input: CompanySiteInput,
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await requireOwnCompany(tx, ctx.actor, { forUpdate: true });
    if (!companyEditability(row.status).locations) throw readOnlyError(row, 'its locations');
    const site = await ownSite(tx, row, siteId);
    // H12: see setMyHeadOffice.
    await assertCityArea(tx, input);
    await tx.update(locs).set(input).where(eq(locs.id, site.id));
    audit({
      action: 'company.update_site',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      after: input,
      metadata: { siteId },
    });
  });
  return myCompany(ctx.actor);
}

/** Sites are archived, not deleted: jobs (M8) may still point at them. */
export async function removeMySite(ctx: SignedIn, siteId: string): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await requireOwnCompany(tx, ctx.actor, { forUpdate: true });
    if (!companyEditability(row.status).locations) throw readOnlyError(row, 'its locations');
    const site = await ownSite(tx, row, siteId);
    await tx.update(locs).set({ archivedAt: new Date() }).where(eq(locs.id, site.id));
    audit({
      action: 'company.remove_site',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      metadata: { siteId, label: site.label },
    });
  });
  return myCompany(ctx.actor);
}

// ─── Submission ────────────────────────────────────────────────────────

/** Sends a DRAFT (or a corrected REJECTED) company to Branch Admin review: a new round. */
export async function submitMyCompany(ctx: SignedIn): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  const now = new Date();
  const dueOn = await verificationDueOn(now);
  let companyId = '';
  try {
    companyId = await runCommand(ctx, async ({ tx, audit }) => {
      const row = await requireOwnCompany(tx, ctx.actor, { forUpdate: true });
      const to = companyMachine.transition(
        row.status,
        'SUBMIT',
        { submissionMissing: await submissionMissing(tx, row), documentsNotAccepted: [] },
        ctx.actor.roles,
      );
      if (await openVerification(tx, row.id)) {
        throw new ConflictError('This company is already waiting for verification');
      }
      // Employer companies always carry an NTN (registerCompanySchema still
      // requires it); the guard is for the now-nullable column type only.
      if (row.ntn) await assertNtnFree(tx, row.ntn, row.id);
      const [{ last } = { last: 0 }] = await tx
        .select({ last: max(ver.round) })
        .from(ver)
        .where(eq(ver.companyId, row.id));
      const [round] = await tx
        .insert(ver)
        .values({
          companyId: row.id,
          branchId: row.branchId!,
          round: (last ?? 0) + 1,
          submittedAt: now,
          clockStartedAt: now,
          slaDueOn: dueOn,
        })
        .returning();
      await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
      await recordTransition(tx, {
        verificationId: round!.id,
        companyId: row.id,
        event: 'SUBMIT',
        fromStatus: row.status,
        toStatus: to,
        actorId: ctx.actor.userId,
        metadata: { round: round!.round, slaDueOn: dueOn },
      });
      audit({
        action: 'company.submit',
        entityType: 'company',
        entityId: row.id,
        branchId: row.branchId,
        before: { status: row.status },
        after: { status: to },
        metadata: { round: round!.round, slaDueOn: dueOn },
      });
      return row.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, ACTIVE_NTN_CONSTRAINT)) throw ntnTaken();
    if (isUniqueViolation(error, 'company_verifications_one_open_uq')) {
      throw new ConflictError('This company is already waiting for verification');
    }
    throw error;
  }
  const view = await myCompany(ctx.actor);
  await emailEmployers(ctx, companyId, ({ name, url }) =>
    companySubmittedEmail({
      name,
      companyName: view.details.legalName,
      dueDate: formatDate(dueOn),
      url,
    }),
  );
  return view;
}

/**
 * M23: the due date for a resubmitted round. When the verifier's info request
 * recorded the working days left (`slaRemainingDays`, migration 0032), the
 * clock resumes from the resubmit date with exactly those days — the same
 * working-days helper `verificationDueOn` uses. Null (a round paused before
 * migration 0032, or one that never paused) keeps the previous behaviour: a
 * full fresh SLA from the resubmit date.
 */
async function resubmitDueOn(now: Date, slaRemainingDays: number | null): Promise<string> {
  if (slaRemainingDays == null) return verificationDueOn(now);
  return slaDueDate(now, slaRemainingDays, await getWorkingCalendar());
}

/** After "more information needed": the employer made the changes and sends it back. */
export async function resubmitMyCompany(
  ctx: SignedIn,
  input: { note: string | null },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  const now = new Date();
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await requireOwnCompany(tx, ctx.actor, { forUpdate: true });
    const to = companyMachine.transition(
      row.status,
      'RESUBMIT',
      { submissionMissing: await submissionMissing(tx, row), documentsNotAccepted: [] },
      ctx.actor.roles,
    );
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new ConflictError('There is no open verification to send back');
    // M18: an unchanged company cannot be bounced back and burn a fresh SLA — a
    // real note, or proof something changed since the verifier asked for more.
    if (
      !isResubmitNoteSufficient(input.note) &&
      !(await changedSinceInfoRequest(tx, row.id, round.infoRequestedAt))
    ) {
      throw new ValidationError([
        {
          path: 'note',
          message:
            'Tell the verifier what you changed or sent (at least 10 characters), or upload the document they asked for first.',
        },
      ]);
    }
    // M23: resubmitting resumes the paused SLA instead of granting a full fresh
    // one — the due date is the resubmit date + the working days that were left
    // when the verifier asked for more information (recorded by requestInfo).
    const dueOn = await resubmitDueOn(now, round.slaRemainingDays);
    await tx
      .update(ver)
      .set({ state: 'RESUBMITTED', employerNote: input.note, clockStartedAt: now, slaDueOn: dueOn })
      .where(eq(ver.id, round.id));
    await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event: 'RESUBMIT',
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
      note: input.note,
      metadata: { slaDueOn: dueOn },
    });
    audit({
      action: 'company.resubmit',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      metadata: { round: round.round, slaDueOn: dueOn },
    });
  });
  return myCompany(ctx.actor);
}

/** Companies the given employer users belong to (used by tests and admin tooling). */
export async function companyIdsForUsers(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ companyId: members.companyId })
    .from(members)
    .where(inArray(members.userId, userIds));
  return rows.map((r) => r.companyId);
}
