-- Add INTERVIEW_POSTPONED and INTERVIEW_CANCELLED to the applications status check.

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_status_check
    CHECK (status IN (
      'SHORTLISTED',
      'INTERVIEW_SCHEDULED',
      'INTERVIEW_POSTPONED',
      'INTERVIEW_CANCELLED',
      'FORWARDED',
      'HIRED',
      'REJECTED'
    ));
