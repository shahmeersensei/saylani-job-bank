-- 0052 — Job Bank interview outcome (Option B, end-to-end interviewer).
-- The interviewer (or Staff/BA) records what happened in a scheduled Job
-- Bank interview: attendance (ATTENDED / NO_SHOW), result (PASSED / FAILED)
-- and feedback. The status moves to INTERVIEW_PASSED or INTERVIEW_FAILED
-- (see applicationMachine: RECORD_INTERVIEW_PASS / RECORD_INTERVIEW_FAIL).
-- PASSED is the only state an interviewer-only actor may refer to the
-- employer from; FAILED is terminal for the interview stage.
-- All columns are nullable with no default, so this is metadata-only (no
-- table rewrite) and existing rows keep no outcome. Status values live in
-- a plain text column (no Postgres enum), so the two new statuses need no
-- ALTER TYPE — the schema list in applications.ts is the source of truth.
ALTER TABLE "applications" ADD COLUMN "interview_attendance" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "interview_result" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "interview_feedback" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "interview_outcome_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "interview_outcome_by" uuid;
