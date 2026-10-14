-- Match decisions (hire/reject with reasons) + applicant offer response + notifications.
ALTER TABLE "job_matches"
	ADD COLUMN "review_reason_code" text,
	ADD COLUMN "review_note" text,
	ADD COLUMN "reviewed_by" uuid,
	ADD COLUMN "reviewed_at" timestamp with time zone,
	ADD COLUMN "applicant_response" text,
	ADD COLUMN "refusal_reason_code" text,
	ADD COLUMN "responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_review_status_valid" CHECK ("job_matches"."review_status" in ('NEW', 'REVIEWED', 'SHORTLISTED', 'HIRED', 'REJECTED'));--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_reject_needs_reason" CHECK ("job_matches"."review_status" <> 'REJECTED' or "job_matches"."review_reason_code" is not null);--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_response_valid" CHECK ("job_matches"."applicant_response" is null or "job_matches"."applicant_response" in ('ACCEPTED', 'DECLINED'));--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_declined_needs_reason" CHECK ("job_matches"."applicant_response" <> 'DECLINED' or "job_matches"."refusal_reason_code" is not null);--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
