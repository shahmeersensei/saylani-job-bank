import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * In-app notifications (M16-lite): decisions on an applicant's matches, offer
 * responses seen by employers. Emails remain best-effort in the domain layer;
 * this table is the authoritative, always-delivered channel.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** MATCH_SHORTLISTED | MATCH_HIRED | MATCH_REJECTED | OFFER_ACCEPTED | OFFER_DECLINED */
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** Typed payload (jobId, applicantId, reasonCode, …) — consumed by the UI. */
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    check('notifications_type_format', sql`${t.type} ~ '^[A-Z0-9]+(_[A-Z0-9]+)*$'`),
  ],
);
