import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const APPLICATION_STATUSES = [
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
  'FORWARDED',
  'EMPLOYER_INTERVIEW_SCHEDULED',
  'EMPLOYER_INTERVIEW_POSTPONED',
  'EMPLOYER_INTERVIEW_CANCELLED',
  'ON_HOLD',
  'OFFER_EXTENDED',
  'EMPLOYER_REJECTED',
  'APPLICANT_REFUSED',
  'HIRED',
  'REJECTED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const EMPLOYER_DECISION_VALUES = ['HOLD', 'ACCEPTED', 'REJECTED'] as const;
export type EmployerDecision = (typeof EMPLOYER_DECISION_VALUES)[number];

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
    // Employer interview stage
    employerInterviewAt: timestamp('employer_interview_at', { withTimezone: true }),
    employerInterviewLocation: text('employer_interview_location'),
    employerInterviewNote: text('employer_interview_note'),
    employerScheduledBy: uuid('employer_scheduled_by'),
    // Employer decision
    employerDecision: text('employer_decision', { enum: EMPLOYER_DECISION_VALUES }),
    employerDecisionAt: timestamp('employer_decision_at', { withTimezone: true }),
    employerDecisionBy: uuid('employer_decision_by'),
    employerDecisionNote: text('employer_decision_note'),
    // Applicant refusal
    applicantRefusalReason: text('applicant_refusal_reason'),
    applicantRefusedAt: timestamp('applicant_refused_at', { withTimezone: true }),
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
