-- M7: keep updated_at accurate for writes that bypass the ORM.
SELECT jobbank_attach_updated_at('companies');
--> statement-breakpoint
SELECT jobbank_attach_updated_at('company_locations');
--> statement-breakpoint
SELECT jobbank_attach_updated_at('company_documents');
--> statement-breakpoint
SELECT jobbank_attach_updated_at('company_verifications');
--> statement-breakpoint
-- Verification transitions are evidence: never edited or deleted (same guard as audit_logs).
SELECT jobbank_make_append_only('verification_history');
--> statement-breakpoint
-- Matching (M9) measures distance from job sites: ST_DWithin needs a GiST index.
CREATE INDEX IF NOT EXISTS company_locations_location_gix ON company_locations USING gist (location);
--> statement-breakpoint
-- Company search by name.
CREATE INDEX IF NOT EXISTS companies_legal_name_lower_idx ON companies (lower(legal_name) text_pattern_ops);
--> statement-breakpoint
-- PRD rule 2: only VERIFIED companies may post jobs. M8's jobs table checks this on insert
-- (a trigger calling this function), in addition to the service-layer check.
CREATE OR REPLACE FUNCTION company_is_verified(company uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM companies WHERE id = company AND status = 'VERIFIED');
$$;
