-- Employer interview stage, employer decisions, applicant refusal, and chat

-- New application statuses (drop + re-add check constraint)
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_status_check
  CHECK (status IN (
    'SHORTLISTED','INTERVIEW_SCHEDULED','INTERVIEW_POSTPONED','INTERVIEW_CANCELLED',
    'FORWARDED',
    'EMPLOYER_INTERVIEW_SCHEDULED','EMPLOYER_INTERVIEW_POSTPONED','EMPLOYER_INTERVIEW_CANCELLED',
    'ON_HOLD','OFFER_EXTENDED','EMPLOYER_REJECTED','APPLICANT_REFUSED',
    'HIRED','REJECTED'
  ));

-- Employer interview columns
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS employer_interview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS employer_interview_location TEXT,
  ADD COLUMN IF NOT EXISTS employer_interview_note TEXT,
  ADD COLUMN IF NOT EXISTS employer_scheduled_by UUID,
  ADD COLUMN IF NOT EXISTS employer_decision TEXT
    CHECK (employer_decision IS NULL OR employer_decision IN ('HOLD','ACCEPTED','REJECTED')),
  ADD COLUMN IF NOT EXISTS employer_decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS employer_decision_by UUID,
  ADD COLUMN IF NOT EXISTS employer_decision_note TEXT,
  ADD COLUMN IF NOT EXISTS applicant_refusal_reason TEXT,
  ADD COLUMN IF NOT EXISTS applicant_refused_at TIMESTAMPTZ;

-- Chat messages
CREATE TABLE IF NOT EXISTS application_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('EMPLOYER','APPLICANT')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_messages_application_idx ON application_messages(application_id, created_at);
