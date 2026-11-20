-- Reserve the applicant registration reference when a first-counter token is
-- issued. Nullable so tokens already in production stay valid; those rows
-- register with a newly generated reference. The same value may repeat
-- across one person's tokens (a repeat visit reuses it). Uniqueness against
-- other people is enforced in the application, with a retry on collision.
-- ADD COLUMN of a nullable column with no default is metadata-only (no table
-- rewrite). The partial index is empty on existing rows (all null) and takes
-- a brief ShareLock, not an AccessExclusive rewrite.
ALTER TABLE "branch_applicant_tokens" ADD COLUMN "registration_reference" text;
--> statement-breakpoint
CREATE INDEX "branch_applicant_tokens_registration_reference_idx"
  ON "branch_applicant_tokens" ("registration_reference")
  WHERE "registration_reference" IS NOT NULL;
