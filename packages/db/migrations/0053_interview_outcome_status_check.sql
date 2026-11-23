-- 0053 — add INTERVIEW_PASSED / INTERVIEW_FAILED to the applications
-- status CHECK (follow-up to 0052).
--
-- 0052 added the two statuses to the schema list in applications.ts and
-- to the state machine, but its comment was wrong: it said the statuses
-- "need no ALTER TYPE" because `status` is a plain text column. True for
-- the column type, but the live database also has the CHECK constraint
-- `applications_status_check` (created in 0015, last rewritten in 0021),
-- which lists every allowed status. It did not include the two new ones,
-- so recording an outcome failed in Postgres with 23514, surfaced by
-- to-response as 422 "Status is not allowed." — the same failure shape
-- as the 0051 branch-scope CHECK. The 3 guard tests in the 0052
-- integration test passed anyway because they never write PASSED/FAILED.
--
-- Existing rows can only hold statuses already in the list, so the
-- DROP + ADD below cannot reject any live row.
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;
--> statement-breakpoint
ALTER TABLE applications ADD CONSTRAINT applications_status_check
  CHECK (status IN (
    'SHORTLISTED',
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_POSTPONED',
    'INTERVIEW_CANCELLED',
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
    'REJECTED'
  ));
