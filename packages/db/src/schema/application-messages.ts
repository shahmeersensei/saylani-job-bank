import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { applications } from './applications';
import { users } from './identity';

export const applicationMessages = pgTable(
  'application_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    senderRole: text('sender_role').notNull(), // EMPLOYER | APPLICANT
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('app_messages_application_idx').on(t.applicationId, t.createdAt)],
);
