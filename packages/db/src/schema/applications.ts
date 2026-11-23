import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const APPLICATION_STATUSES = [
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
  // 0052 — Job Bank interview outcome (Option B, end-to-end interviewer):
  // recorded by the interviewer (or Staff/BA) after a scheduled interview.
  // PASSED is the only interviewer-referrable state; FAILED is terminal
  // for the interview stage (no reschedule, no referral).
  'INTERVIEW_PASSED',
  'INTERVIEW_FAILED',
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
    // 0052 — Job Bank interview outcome, recorded after a scheduled
    // interview (see recordInterviewOutcome). All nullable: rows created
    // before 0052, and rows not yet interviewed, have no outcome.
    // attendance: 'ATTENDED' | 'NO_SHOW'; result: 'PASSED' | 'FAILED'
    // (a no-show is always FAILED). feedback is the interviewer's note
    // (required when FAILED, ≥5 chars — M19-style evidence rule).
    interviewAttendance: text('interview_attendance'),
    interviewResult: text('interview_result'),
    interviewFeedback: text('interview_feedback'),
    interviewOutcomeAt: timestamp('interview_outcome_at', { withTimezone: true }),
    interviewOutcomeBy: uuid('interview_outcome_by'),
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
    // Counter call list: which status the candidate was last phoned about.
    lastCallStatus: text('last_call_status'),
    lastCalledAt: timestamp('last_called_at', { withTimezone: true }),
    lastCalledBy: uuid('last_called_by'),
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

/**
 * Every employer decision, kept forever (PRD 7.2). Rows can only be added: the database rejects
 * UPDATE and DELETE. `applications` and `job_matches` hold the current state; this is the record.
 * Ported from Najam (2026-11-11) as migration 0045; the REJECTED evidence rule follows this
 * repo's M19 threshold (note ≥ 5 chars) rather than Najam's ≥ 10.
 */
export const employerDecisions = pgTable(
  'employer_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').notNull(),
    applicantId: uuid('applicant_id').notNull(),
    /** Set for the referral workflow; null when decided from the match shortlist. */
    applicationId: uuid('application_id'),
    decision: text('decision').notNull(),
    reasonCode: text('reason_code'),
    evidence: text('evidence'),
    decidedBy: uuid('decided_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('employer_decisions_application_idx').on(t.applicationId),
    index('employer_decisions_job_applicant_idx').on(t.jobId, t.applicantId),
  ],
);
