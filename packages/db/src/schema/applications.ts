import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const APPLICATION_STATUSES = [
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'FORWARDED',
  'HIRED',
  'REJECTED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: uuid('applicant_id').notNull(),
    jobId: uuid('job_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    status: text('status', { enum: APPLICATION_STATUSES }).notNull().default('SHORTLISTED'),
    note: text('note'),
    interviewAt: timestamp('interview_at', { withTimezone: true }),
    interviewLocation: text('interview_location'),
    interviewNote: text('interview_note'),
    scheduledBy: uuid('scheduled_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('applications_applicant_job_uq').on(t.applicantId, t.jobId),
    index('applications_applicant_idx').on(t.applicantId),
    index('applications_job_idx').on(t.jobId),
    index('applications_branch_idx').on(t.branchId),
  ],
);
