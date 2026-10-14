-- Auto matching engine (services/matching, Python): runs, shortlist rows,
-- factor breakdowns, and an outbox the worker polls.
-- pgvector / embeddings table lives in 0019_embeddings.sql (requires the
-- `vector` extension; skip that migration on plain Postgres installs).

CREATE TABLE "match_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"trigger_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"criteria_version" integer DEFAULT 1 NOT NULL,
	"scoring_version" text DEFAULT 'v1' NOT NULL,
	"candidate_count" integer,
	"eligible_count" integer,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"score" integer,
	"distance_m" integer,
	"review_status" text DEFAULT 'NEW' NOT NULL,
	"summary" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_matches_score_range" CHECK (score >= 0 AND score <= 100)
);
--> statement-breakpoint
CREATE TABLE "job_match_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_match_id" uuid NOT NULL,
	"factor" text NOT NULL,
	"score" numeric(6,2) NOT NULL,
	"weight" numeric(6,2) NOT NULL,
	"reason" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."match_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "job_match_factors" ADD CONSTRAINT "job_match_factors_job_match_id_fkey" FOREIGN KEY ("job_match_id") REFERENCES "public"."job_matches"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
CREATE UNIQUE INDEX "match_runs_active_uq" ON "match_runs" USING btree ("job_id") WHERE "status" IN ('PENDING', 'RUNNING');--> statement-breakpoint
CREATE INDEX "match_runs_job_idx" ON "match_runs" USING btree ("job_id", "created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "job_matches_run_applicant_uq" ON "job_matches" USING btree ("run_id", "applicant_id");--> statement-breakpoint
CREATE INDEX "job_matches_job_score_idx" ON "job_matches" USING btree ("job_id", "score" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "job_match_factors_match_factor_uq" ON "job_match_factors" USING btree ("job_match_id", "factor");--> statement-breakpoint
CREATE UNIQUE INDEX "match_outbox_pending_dedupe_uq" ON "match_outbox" USING btree ("event_type", "dedupe_key") WHERE "status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "match_outbox_claim_idx" ON "match_outbox" USING btree ("status", "next_attempt_at");--> statement-breakpoint
