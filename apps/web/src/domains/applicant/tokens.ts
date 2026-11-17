import 'server-only';
import { schema } from '@jobbank/db';
import {
  karachiDay,
  MAX_TOKEN_NUMBER,
  parseTokenCode,
  tokenCodeFor,
  tokenExpiresAt,
  type ApplicantTokenView,
  type CancelApplicantTokenInput,
  type IssueApplicantTokenInput,
  type TokenLookupQuery,
} from '@jobbank/shared';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import { getBranchContact } from '@/domains/branch';
import { runCommand, type AuditEntry, type CommandScope } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  isUniqueViolation,
} from '@/domains/shared/errors';
import {
  assertBranchAccess,
  assertPermission,
  hasRole,
  isSuperAdmin,
} from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { cnicTakenError } from './profile';
import { cnicOwner, type SignedIn } from './repository';

const tokens = schema.branchApplicantTokens;

/**
 * First-counter token (2026-11-07 reversal): the first counter collects a
 * CNIC + name + phone number and issues a numbered token for the day. The
 * number is a daily sequence per branch, starting at 1. The full
 * registration happens at a later step and links back through `applicantId`
 * on the token row.
 *
 * Step 2 (2026-11-08, revised 2026-11-17): tokens now expire exactly 24
 * hours after issue (`expires_at`, migration 0035), can be looked up and
 * reprinted, can be cancelled (which frees the CNIC for a new token), and are
 * completed — ISSUED → COMPLETED with the applicant linked — by the full
 * registration in the same transaction. Because the 24-hour validity spans
 * midnight, a live token issued yesterday must be re-handed, never duplicated:
 * the issue dedupe and the CNIC lookup check unexpired ISSUED tokens across
 * days, not just today.
 */

/** Retries for the daily-number race (N2): 10 attempts, then a 409 to retry. */
const TOKEN_ISSUE_ATTEMPTS = 10;

export type { ApplicantTokenView };

/** `issueApplicantToken` result: `reissued` is true when an existing token was handed back. */
export interface IssueApplicantTokenResult {
  view: ApplicantTokenView;
  /** True when the caller got a token issued earlier (same CNIC, same day). */
  reissued: boolean;
}

function toView(
  row: typeof tokens.$inferSelect,
  branch: { id: string; code: string; name: string },
): ApplicantTokenView {
  return {
    id: row.id,
    tokenNumber: row.tokenNumber,
    tokenCode: tokenCodeFor(branch.code, row.tokenNumber),
    branchId: row.branchId,
    branchCode: branch.code,
    branchName: branch.name,
    cnic: row.cnic,
    applicantName: row.applicantName,
    phone: row.phone,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= Date.now(),
    status: row.status,
    applicantId: row.applicantId,
  };
}

/**
 * Audit 2026-11-11 (M-06): an expired ISSUED token is dead — cancel it
 * (guarded by status = ISSUED) so the (branch, day, cnic) partial unique
 * index frees the CNIC for a fresh issue. No-op if the token was already
 * completed or cancelled in between.
 */
async function cancelExpiredToken(
  ctx: SignedIn,
  token: { id: string; tokenNumber: number; branchId: string },
): Promise<void> {
  await runCommand(ctx, async ({ tx, audit }) => {
    const [row] = await tx
      .update(tokens)
      .set({ status: 'CANCELLED' })
      .where(and(eq(tokens.id, token.id), eq(tokens.status, 'ISSUED')))
      .returning();
    if (!row) return;
    audit({
      action: 'applicant.token_cancelled',
      entityType: 'applicant_token',
      entityId: token.id,
      branchId: token.branchId,
      before: { status: 'ISSUED' },
      after: { status: 'CANCELLED' },
      reason: 'expired',
      metadata: { tokenNumber: token.tokenNumber },
    });
  });
}

/** Issue a token for a person at the branch (Staff / Branch Admin / Super Admin). */
/** Issue a token for a person at the branch (Staff only, since 2026-11-12: Super Admin and Branch Admin no longer issue tokens). */
export async function issueApplicantToken(
  ctx: SignedIn,
  input: IssueApplicantTokenInput,
): Promise<IssueApplicantTokenResult> {
  assertPermission(ctx.actor, 'applicant:manage');
  if (hasRole(ctx.actor, 'SUPER_ADMIN', 'BRANCH_ADMIN')) {
    throw new ForbiddenError('Only Staff can issue applicant tokens');
  }
  if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, input.branchId);

  const branch = await getBranchContact(input.branchId);
  if (!branch) {
    throw new ValidationError([{ path: 'branchId', message: 'Choose a branch' }]);
  }
  if (!branch.isActive) {
    throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
  }

  // A CNIC that already has a full profile never gets a token: the person
  // recovers their account at the branch that holds it instead.
  const owner = await cnicOwner(db, input.cnic);
  if (owner) throw await cnicTakenError(db, owner);

  // N3: one instant drives the whole issue — the Pakistan day, `issued_at`
  // and `expires_at` can never disagree across a midnight rollover. Expiry
  // is exactly 24 hours after issue (APPLICANT_TOKEN_TTL_MINUTES = 1440),
  // calculated on the backend — never trusted from the frontend.
  const now = new Date();
  const today = karachiDay(now);
  const expiresAt = tokenExpiresAt(now);

  // Same person, same branch: hand back the token already issued instead of
  // a duplicate (e.g. the slip was lost, or the counter double-clicked).
  // No day filter: a 24-hour token issued yesterday can still be live today,
  // and issuing a second one for the same CNIC would break the one-live-token
  // rule. Only the most recent ISSUED token is considered; an expired one is
  // auto-cancelled below, exactly as for a same-day expiry.
  let [existing] = await db
    .select()
    .from(tokens)
    .where(
      and(
        eq(tokens.branchId, input.branchId),
        eq(tokens.cnic, input.cnic),
        eq(tokens.status, 'ISSUED'),
      ),
    )
    .orderBy(desc(tokens.issuedAt))
    .limit(1);
  // Audit 2026-11-11 (M-06): an expired ISSUED token is dead — never
  // re-hand it. Cancel it first, then fall through to a fresh issue below.
  if (existing && existing.expiresAt.getTime() <= now.getTime()) {
    await cancelExpiredToken(ctx, existing);
    existing = undefined;
  }
  if (existing) {
    // If the name or phone now differ (a correction, or the slip details were
    // mistyped), update the stored details instead of silently returning the
    // stale ones (L17) — and audit the correction.
    if (existing.applicantName !== input.applicantName || existing.phone !== input.phone) {
      const updated = await runCommand(ctx, async ({ tx, audit }) => {
        const [row] = await tx
          .update(tokens)
          .set({ applicantName: input.applicantName, phone: input.phone })
          // Audit 2026-11-10 (A-M2): the SELECT above found an ISSUED
          // token, but it may have been completed/cancelled in between —
          // never rewrite a COMPLETED/CANCELLED token's name/phone.
          .where(and(eq(tokens.id, existing.id), eq(tokens.status, 'ISSUED')))
          .returning();
        if (!row) throw new ConflictError('This token was already completed or cancelled.');
        audit({
          action: 'applicant.token_reissued',
          entityType: 'applicant_token',
          entityId: existing.id,
          branchId: input.branchId,
          before: { applicantName: existing.applicantName, phone: existing.phone },
          after: { applicantName: input.applicantName, phone: input.phone },
          metadata: { tokenNumber: existing.tokenNumber },
        });
        return row!;
      });
      return { view: toView(updated, branch), reissued: true };
    }
    return { view: toView(existing, branch), reissued: true };
  }

  // Two counters can issue at the same moment: the unique indexes are the guard —
  // (branch, day, number) for the daily sequence, and the partial unique index on
  // (branch, day, cnic) WHERE status = 'ISSUED' (migration 0031) for the same-CNIC
  // dedupe (H22). On a collision, retry with the next number — or hand back the
  // token that won the race.
  // N2: the retry budget is 10 attempts (was 5). MAX() still counts CANCELLED
  // rows, deliberately: the (branch, day, number) unique index is unconditional,
  // so reusing a cancelled number would collide on insert. A cancelled token
  // burns one number out of 9999 — a harmless queue gap, not a leak worth an
  // index rebuild.
  for (let attempt = 0; attempt < TOKEN_ISSUE_ATTEMPTS; attempt++) {
    try {
      const row = await runCommand(ctx, async ({ tx, audit }) => {
        const recheckedOwner = await cnicOwner(tx, input.cnic);
        if (recheckedOwner) throw await cnicTakenError(tx, recheckedOwner);

        const [highest] = await tx
          .select({ value: max(tokens.tokenNumber) })
          .from(tokens)
          .where(and(eq(tokens.branchId, input.branchId), eq(tokens.registrationDay, today)));
        const tokenNumber = (highest?.value ?? 0) + 1;
        if (tokenNumber > MAX_TOKEN_NUMBER) {
          throw new ConflictError(
            'No more token numbers are available for this branch today. Please ask a Super Admin.',
          );
        }

        const [created] = await tx
          .insert(tokens)
          .values({
            branchId: input.branchId,
            registrationDay: today,
            tokenNumber,
            cnic: input.cnic,
            applicantName: input.applicantName,
            phone: input.phone,
            issuedBy: ctx.actor.userId,
            issuedAt: now,
            expiresAt,
          })
          .returning();
        if (!created) throw new Error('Token could not be saved.');
        audit({
          action: 'applicant.token_issued',
          entityType: 'applicant_token',
          entityId: created.id,
          branchId: input.branchId,
          after: {
            tokenNumber,
            tokenCode: tokenCodeFor(branch.code, tokenNumber),
            cnic: input.cnic,
            applicantName: input.applicantName,
            phone: input.phone,
          },
          metadata: { issuedBy: ctx.actor.userId },
        });
        return created;
      });
      return { view: toView(row, branch), reissued: false };
    } catch (error) {
      if (
        isUniqueViolation(error, 'branch_applicant_tokens_branch_day_number_unique') &&
        attempt < TOKEN_ISSUE_ATTEMPTS - 1
      ) {
        continue;
      }
      if (isUniqueViolation(error, 'branch_applicant_tokens_branch_day_cnic_issued_unique')) {
        // A second counter issued for the same CNIC at the same moment: the
        // partial unique index caught the race — hand back the token that won.
        // No day filter: the winner may be yesterday's still-live token.
        const [winner] = await db
          .select()
          .from(tokens)
          .where(
            and(
              eq(tokens.branchId, input.branchId),
              eq(tokens.cnic, input.cnic),
              eq(tokens.status, 'ISSUED'),
            ),
          )
          .orderBy(desc(tokens.issuedAt))
          .limit(1);
        if (winner) {
          // Audit 2026-11-11 (M-06): the race winner may be an expired
          // token — never hand back a dead token. Cancel it first (frees
          // the CNIC for a fresh issue) and retry the loop.
          if (winner.expiresAt.getTime() <= Date.now()) {
            await cancelExpiredToken(ctx, winner);
            continue;
          }
          return { view: toView(winner, branch), reissued: true };
        }
      }
      // Audit 2026-11-10 (A-L3): on the final attempt a number-unique
      // violation used to fall through as a raw Postgres 500, even though
      // the friendly retry message below exists for exactly this case.
      if (isUniqueViolation(error, 'branch_applicant_tokens_branch_day_number_unique'))
        throw new ConflictError('Could not issue a token. Please try again.');
      throw error;
    }
  }
  throw new ConflictError('Could not issue a token. Please try again.');
}

// ─── Lookup / reprint ──────────────────────────────────────────────────

/**
 * Staff token lookup (step 2): by token code (`KHI-GULSHAN-007`), by CNIC +
 * branch (+ day, default today), or the whole branch-day list. Always
 * branch-scoped; Super Admins may look up any branch. A token code has no
 * day in it, and numbers reset daily — so the code lookup returns EVERY
 * token with that branch + number, most recent day first, and the dialog
 * shows each one's issue date so staff pick the right day (M-07). Returns
 * an array so the list and single shapes stay one contract.
 */
export async function lookupApplicantTokens(
  ctx: SignedIn,
  query: TokenLookupQuery,
): Promise<ApplicantTokenView[]> {
  assertPermission(ctx.actor, 'applicant:manage');

  if (query.tokenCode) {
    const parsed = parseTokenCode(query.tokenCode.trim());
    if (!parsed) {
      throw new ValidationError([
        { path: 'tokenCode', message: 'Enter a token code like KHI-GULSHAN-007' },
      ]);
    }
    const [branchRow] = await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.code, parsed.branchCode));
    if (!branchRow) throw new NotFoundError('Token');
    if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, branchRow.id);
    const branch = await getBranchContact(branchRow.id);
    if (!branch) throw new NotFoundError('Token');
    // Audit 2026-11-11 (M-07): no `.limit(1)` here — the number is reused
    // every day, so returning only the most recent silently hands staff a
    // different person's slip. Return all days, most recent first.
    const rows = await db
      .select()
      .from(tokens)
      .where(and(eq(tokens.branchId, branch.id), eq(tokens.tokenNumber, parsed.tokenNumber)))
      .orderBy(desc(tokens.registrationDay), desc(tokens.issuedAt))
      .limit(30);
    return rows.map((row) => toView(row, branch));
  }

  const branchId = query.branchId!;
  if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, branchId);
  const branch = await getBranchContact(branchId);
  if (!branch) {
    throw new ValidationError([{ path: 'branchId', message: 'Choose a branch' }]);
  }
  const day = query.day ?? karachiDay();

  if (query.cnic) {
    const cnic = query.cnic.replace(/[\s-]/g, '');
    // No explicit day: a 24-hour token issued yesterday can still be live
    // today, so the CNIC lookup must find it — search across days, most
    // recent first. An explicit day keeps its exact-day meaning (the
    // branch-day list below, and staff checking a specific day).
    const conditions = [eq(tokens.branchId, branchId), eq(tokens.cnic, cnic)];
    if (query.day) conditions.push(eq(tokens.registrationDay, day));
    const [row] = await db
      .select()
      .from(tokens)
      .where(and(...conditions))
      .orderBy(desc(tokens.issuedAt))
      .limit(1);
    return row ? [toView(row, branch)] : [];
  }

  const rows = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.branchId, branchId), eq(tokens.registrationDay, day)))
    .orderBy(asc(tokens.tokenNumber))
    .limit(100);
  return rows.map((row) => toView(row, branch));
}

// ─── Cancel / complete ─────────────────────────────────────────────────

/**
 * Cancel an ISSUED token (N5): the person left, or the slip details were
 * wrong and the counter wants a clean re-issue. A CANCELLED token does not
 * block a new token for the same CNIC the same day — the 0031 partial unique
 * index only covers ISSUED rows, so the next issue is a fresh number.
 * COMPLETED tokens can never be cancelled (the applicant already exists).
 */
export async function cancelApplicantToken(
  ctx: SignedIn,
  tokenId: string,
  input: CancelApplicantTokenInput = {},
): Promise<ApplicantTokenView> {
  assertPermission(ctx.actor, 'applicant:manage');
  const [existing] = await db.select().from(tokens).where(eq(tokens.id, tokenId));
  if (!existing) throw new NotFoundError('Token');
  if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, existing.branchId);
  if (existing.status !== 'ISSUED') {
    throw new ConflictError(
      `Only an issued token can be cancelled (this one is ${existing.status}).`,
    );
  }
  const branch = await getBranchContact(existing.branchId);
  if (!branch) throw new NotFoundError('Token');
  const updated = await runCommand(ctx, async ({ tx, audit }) => {
    const [row] = await tx
      .update(tokens)
      .set({ status: 'CANCELLED' })
      .where(and(eq(tokens.id, tokenId), eq(tokens.status, 'ISSUED')))
      .returning();
    if (!row) {
      throw new ConflictError('This token was already completed or cancelled.');
    }
    audit({
      action: 'applicant.token_cancelled',
      entityType: 'applicant_token',
      entityId: tokenId,
      branchId: existing.branchId,
      before: { status: 'ISSUED' },
      after: { status: 'CANCELLED' },
      reason: input.reason,
      metadata: { tokenNumber: existing.tokenNumber },
    });
    return row;
  });
  return toView(updated, branch);
}

/**
 * Complete a token inside an already-open transaction — called by
 * `staffRegisterApplicant` after the applicant row is created, so the
 * ISSUED → COMPLETED transition and the registration commit or roll back
 * together. The token must be ISSUED, unexpired, for this branch and CNIC;
 * anything else is a 409 and the whole registration fails.
 */
export async function completeTokenForRegistration(
  tx: CommandScope['tx'],
  audit: (entry: AuditEntry) => void,
  args: { tokenId: string; applicantId: string; branchId: string; cnic: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  const [row] = await tx.select().from(tokens).where(eq(tokens.id, args.tokenId));
  if (!row) throw new NotFoundError('Token');
  if (row.branchId !== args.branchId) {
    throw new ConflictError('This token was issued at a different branch.');
  }
  if (row.cnic !== args.cnic) {
    throw new ConflictError('This token was issued for a different CNIC.');
  }
  if (row.status !== 'ISSUED') {
    throw new ConflictError(`This token is already ${row.status}.`);
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new ConflictError('This token expired 24 hours after it was issued. Issue a new token.');
  }
  const [updated] = await tx
    .update(tokens)
    .set({ status: 'COMPLETED', applicantId: args.applicantId })
    .where(and(eq(tokens.id, args.tokenId), eq(tokens.status, 'ISSUED')))
    .returning();
  if (!updated) {
    throw new ConflictError('This token was already completed or cancelled.');
  }
  audit({
    action: 'applicant.token_completed',
    entityType: 'applicant_token',
    entityId: args.tokenId,
    branchId: args.branchId,
    before: { status: 'ISSUED', applicantId: null },
    after: { status: 'COMPLETED', applicantId: args.applicantId },
    metadata: { tokenNumber: row.tokenNumber },
  });
}
