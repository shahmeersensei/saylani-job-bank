import 'server-only';
import { schema } from '@jobbank/db';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { NotFoundError } from '@/domains/shared/errors';
import type { Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';

const n = schema.notifications;
const cm = schema.companyMembers;

export type NotificationType =
  'MATCH_SHORTLISTED' | 'MATCH_HIRED' | 'MATCH_REJECTED' | 'OFFER_ACCEPTED' | 'OFFER_DECLINED';

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
  await executor.insert(n).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? '',
    data: input.data ?? {},
  });
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
  for (const member of members) {
    const payload = build({ userId: member.userId });
    if (payload) await createNotification(executor, payload);
  }
}

export interface ListNotificationsQuery {
  page: number;
  pageSize: number;
}

export async function listMyNotifications(
  actor: Actor,
  query: ListNotificationsQuery,
): Promise<{ items: NotificationView[]; total: number; unread: number }> {
  const where = eq(n.userId, actor.userId);

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
