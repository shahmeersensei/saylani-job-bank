import 'server-only';
import { schema } from '@jobbank/db';
import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { NotFoundError } from '@/domains/shared/errors';
import type { Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';

const n = schema.notifications;
const cm = schema.companyMembers;

/**
 * Every notification type the app can still produce. Retired types are NOT
 * listed here: a row whose type was removed (e.g. JOB_REFERRED, the
 * job-to-employer referral deleted 2026-11-08) must never render again, so
 * the read queries below filter to this list. Keep this list and the
 * createNotification callers in sync — a type produced but not listed here
 * would silently never be seen.
 */
export const KNOWN_NOTIFICATION_TYPES = [
  'MATCH_SHORTLISTED',
  'MATCH_HIRED',
  'MATCH_REJECTED',
  'OFFER_ACCEPTED',
  'OFFER_DECLINED',
  // Audit 2026-11-11 (M-16): OFFER_EXTENDED is the employer extending an
  // offer; OFFER_ACCEPTED is only the applicant accepting it. Reusing one
  // type for both showed applicants OFFER_ACCEPTED before they accepted.
  'OFFER_EXTENDED',
  // Audit 2026-11-11 (L-12): the employer decision on a candidate a staff
  // member referred, notified to that referrer.
  'REFERRAL_DECISION',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
  'INTERVIEW_RESCHEDULED',
  // 0052 — interview outcome notifications (see recordInterviewOutcome).
  'INTERVIEW_PASSED',
  'INTERVIEW_FAILED',
  // Audit 2026-11-23 (LOW-3): the employer's own interview used the Job
  // Bank interview types, so the applicant's list showed two
  // indistinguishable "Interview scheduled" entries. Employer interviews
  // now have their own types.
  'EMPLOYER_INTERVIEW_SCHEDULED',
  'EMPLOYER_INTERVIEW_POSTPONED',
  'EMPLOYER_INTERVIEW_RESCHEDULED',
  'EMPLOYER_INTERVIEW_CANCELLED',
  'APPLICANT_REFERRED',
  'JOB_REFERRED_TO_APPLICANT',
  'APPLICATION_ON_HOLD',
  'MESSAGE',
  // M25 — company-side events. The placement/notification types above were
  // the template: suspend/reinstate/transfer notify the company's employer
  // users, assign-verifier notifies the assigned verifier.
  'COMPANY_SUSPENDED',
  'COMPANY_REINSTATED',
  'VERIFIER_ASSIGNED',
  'COMPANY_TRANSFERRED',
  // Audit 2026-11-11 (M-15): verification outcomes were email-only; they
  // now notify in-app too (employer members + the staff onboarder).
  'COMPANY_VERIFIED',
  'COMPANY_REJECTED',
  'COMPANY_INFO_REQUESTED',
  // Audit 2026-11-11 (M-28): the user whose authenticator an admin removed.
  'TWO_FACTOR_RESET',
] as const;

export type NotificationType = (typeof KNOWN_NOTIFICATION_TYPES)[number];

/** True for types the app still produces; false for retired ones (JOB_REFERRED, …). */
export function isKnownNotificationType(type: string): type is NotificationType {
  return (KNOWN_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

/** Insert one notification (inside a tx or standalone). */
export async function createNotification(
  executor: DbExecutor,
  input: CreateNotificationInput,
): Promise<void> {
  await createNotifications(executor, [input]);
}

/** Insert many notifications in a single statement (fan-outs, batch sends). */
export async function createNotifications(
  executor: DbExecutor,
  inputs: CreateNotificationInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  await executor.insert(n).values(
    inputs.map((input) => ({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      data: input.data ?? {},
    })),
  );
}

/** Fan-out to every employer user of a company (offer responses, …). */
export async function notifyCompanyEmployers(
  executor: DbExecutor,
  companyId: string,
  build: (input: { userId: string }) => CreateNotificationInput | null,
): Promise<void> {
  const members = await executor
    .select({ userId: cm.userId })
    .from(cm)
    .where(eq(cm.companyId, companyId));
  // One insert for the whole fan-out, not one per member.
  const payloads = members.flatMap((member) => {
    const payload = build({ userId: member.userId });
    return payload ? [payload] : [];
  });
  await createNotifications(executor, payloads);
}

export interface ListNotificationsQuery {
  page: number;
  pageSize: number;
}

export async function listMyNotifications(
  actor: Actor,
  query: ListNotificationsQuery,
): Promise<{ items: NotificationView[]; total: number; unread: number }> {
  // Retired types never render: a leftover row (e.g. JOB_REFERRED from the
  // removed job-to-employer referral) is invisible even before migration
  // 0039 deletes it, and the counts match what the user actually sees.
  const where = and(eq(n.userId, actor.userId), inArray(n.type, [...KNOWN_NOTIFICATION_TYPES]));

  const [totalRow, unreadRow] = await Promise.all([
    db.select({ total: count() }).from(n).where(where),
    db
      .select({ total: count() })
      .from(n)
      .where(and(where, isNull(n.readAt))),
  ]);

  const rows = await db
    .select()
    .from(n)
    .where(where)
    .orderBy(desc(n.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      data: r.data,
      readAt: r.readAt,
      createdAt: r.createdAt,
    })),
    total: totalRow[0]?.total ?? 0,
    unread: unreadRow[0]?.total ?? 0,
  };
}

/** Poll for notifications newer than a given ISO timestamp (used by SSE stream). */
export async function getNewNotificationsSince(
  userId: string,
  since: Date,
): Promise<NotificationView[]> {
  const rows = await db
    .select()
    .from(n)
    .where(
      and(
        eq(n.userId, userId),
        gt(n.createdAt, since),
        inArray(n.type, [...KNOWN_NOTIFICATION_TYPES]),
      ),
    )
    .orderBy(desc(n.createdAt))
    .limit(20);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    data: r.data as Record<string, unknown>,
    readAt: r.readAt,
    createdAt: r.createdAt,
  }));
}

export async function markNotificationRead(actor: Actor, id: string): Promise<void> {
  const updated = await db
    .update(n)
    .set({ readAt: new Date() })
    .where(and(eq(n.id, id), eq(n.userId, actor.userId), isNull(n.readAt)))
    .returning({ id: n.id });
  // Already-read rows are a no-op success; a foreign id is a 404.
  if (updated.length === 0) {
    const [exists] = await db
      .select({ id: n.id })
      .from(n)
      .where(and(eq(n.id, id), eq(n.userId, actor.userId)))
      .limit(1);
    if (!exists) throw new NotFoundError('Notification', id);
  }
}

export async function markAllNotificationsRead(actor: Actor): Promise<{ updated: number }> {
  const updated = await db
    .update(n)
    .set({ readAt: new Date() })
    .where(and(eq(n.userId, actor.userId), isNull(n.readAt)))
    .returning({ id: n.id });
  return { updated: updated.length };
}
