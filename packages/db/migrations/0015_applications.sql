-- M10: Applications (shortlist + interview scheduling)

CREATE TABLE applications (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id   UUID        NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  job_id         UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  branch_id      UUID        NOT NULL REFERENCES branches(id),
  created_by     UUID        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'SHORTLISTED'
                             CHECK (status IN ('SHORTLISTED','INTERVIEW_SCHEDULED','FORWARDED','HIRED','REJECTED')),
  note           TEXT,
  -- Interview fields (populated when status = INTERVIEW_SCHEDULED)
  interview_at       TIMESTAMPTZ,
  interview_location TEXT,
  interview_note     TEXT,
  scheduled_by       UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One active application per applicant-job pair
  UNIQUE (applicant_id, job_id)
);

CREATE INDEX applications_applicant_idx ON applications(applicant_id);
CREATE INDEX applications_job_idx       ON applications(job_id);
CREATE INDEX applications_branch_idx    ON applications(branch_id);
CREATE INDEX applications_status_idx    ON applications(status);
