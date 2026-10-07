CREATE TABLE "email_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"legal_structure" text NOT NULL,
	"ntn" text NOT NULL,
	"registration_no" text,
	"industry_code" text NOT NULL,
	"size_band" text NOT NULL,
	"website" text,
	"description" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"status_reason" text,
	"verified_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_status_valid" CHECK ("companies"."status" in ('DRAFT', 'SUBMITTED', 'UNDER_VERIFICATION', 'INFO_REQUESTED', 'RESUBMITTED', 'VERIFIED', 'REJECTED', 'SUSPENDED')),
	CONSTRAINT "companies_legal_structure_valid" CHECK ("companies"."legal_structure" in ('SOLE_PROPRIETOR', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'NGO_TRUST')),
	CONSTRAINT "companies_size_band_valid" CHECK ("companies"."size_band" in ('1_10', '11_50', '51_200', '201_500', '500_PLUS')),
	CONSTRAINT "companies_ntn_format" CHECK ("companies"."ntn" ~ '^([0-9]{7}(-[0-9])?|[1-9][0-9]{12})$'),
	CONSTRAINT "companies_submitted_needs_branch" CHECK ("companies"."status" = 'DRAFT' or "companies"."branch_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "company_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"designation" text,
	"phone" text NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_document_requirements" (
	"legal_structure" text NOT NULL,
	"document_type_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_document_requirements_legal_structure_document_type_code_pk" PRIMARY KEY("legal_structure","document_type_code"),
	CONSTRAINT "company_document_requirements_structure_valid" CHECK ("company_document_requirements"."legal_structure" in ('SOLE_PROPRIETOR', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'NGO_TRUST'))
);
--> statement-breakpoint
CREATE TABLE "company_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"scan_result" text,
	"review_status" text DEFAULT 'PENDING' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone,
	"replaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_documents_storageKey_unique" UNIQUE("storage_key"),
	CONSTRAINT "company_documents_status_valid" CHECK ("company_documents"."status" in ('PENDING_UPLOAD', 'UPLOADED', 'INFECTED')),
	CONSTRAINT "company_documents_review_status_valid" CHECK ("company_documents"."review_status" in ('PENDING', 'ACCEPTED', 'REJECTED')),
	CONSTRAINT "company_documents_size_positive" CHECK ("company_documents"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "company_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"address_line" text NOT NULL,
	"city_code" text NOT NULL,
	"area_code" text,
	"location" geography(Point, 4326) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_locations_kind_valid" CHECK ("company_locations"."kind" in ('HQ', 'SITE')),
	CONSTRAINT "company_locations_hq_not_archived" CHECK ("company_locations"."kind" = 'SITE' or "company_locations"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'OWNER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_members_company_id_user_id_pk" PRIMARY KEY("company_id","user_id"),
	CONSTRAINT "company_members_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "company_members_role_valid" CHECK ("company_members"."role" in ('OWNER'))
);
--> statement-breakpoint
CREATE TABLE "company_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"state" text DEFAULT 'SUBMITTED' NOT NULL,
	"assigned_verifier_id" uuid,
	"assigned_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sla_due_on" date NOT NULL,
	"employer_note" text,
	"info_request" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"rejection_reason_code" text,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_verifications_round_uq" UNIQUE("company_id","round"),
	CONSTRAINT "company_verifications_state_valid" CHECK ("company_verifications"."state" in ('SUBMITTED', 'UNDER_VERIFICATION', 'INFO_REQUESTED', 'RESUBMITTED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT "company_verifications_decided" CHECK (("company_verifications"."state" in ('VERIFIED', 'REJECTED')) = ("company_verifications"."decided_at" is not null)),
	CONSTRAINT "company_verifications_rejection_reason" CHECK ("company_verifications"."state" <> 'REJECTED' or "company_verifications"."rejection_reason_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "verification_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verification_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" uuid,
	"note" text,
	"reason_code" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_history_event_valid" CHECK ("verification_history"."event" in ('SUBMIT', 'CLAIM', 'RELEASE', 'DECLARE_CONFLICT', 'ASSIGN', 'REQUEST_INFO', 'RESUBMIT', 'VERIFY', 'REJECT', 'SUSPEND', 'REINSTATE'))
);
--> statement-breakpoint
ALTER TABLE "master_data" DROP CONSTRAINT "master_data_type_valid";--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_verifications" ADD CONSTRAINT "company_verifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_verifications" ADD CONSTRAINT "company_verifications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_verifications" ADD CONSTRAINT "company_verifications_assigned_verifier_id_users_id_fk" FOREIGN KEY ("assigned_verifier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_verifications" ADD CONSTRAINT "company_verifications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_history" ADD CONSTRAINT "verification_history_verification_id_company_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."company_verifications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_history" ADD CONSTRAINT "verification_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_history" ADD CONSTRAINT "verification_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_challenges_open_idx" ON "email_challenges" USING btree ("email","purpose") WHERE "email_challenges"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "companies_branch_status_idx" ON "companies" USING btree ("branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_ntn_active_uq" ON "companies" USING btree ("ntn") WHERE "companies"."status" not in ('DRAFT', 'REJECTED');--> statement-breakpoint
CREATE INDEX "company_contacts_company_idx" ON "company_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_contacts_one_primary_uq" ON "company_contacts" USING btree ("company_id") WHERE "company_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "company_documents_current_idx" ON "company_documents" USING btree ("company_id","type_code") WHERE "company_documents"."replaced_at" is null;--> statement-breakpoint
CREATE INDEX "company_locations_company_idx" ON "company_locations" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_locations_one_hq_uq" ON "company_locations" USING btree ("company_id") WHERE "company_locations"."kind" = 'HQ';--> statement-breakpoint
CREATE UNIQUE INDEX "company_verifications_one_open_uq" ON "company_verifications" USING btree ("company_id") WHERE "company_verifications"."state" in ('SUBMITTED', 'UNDER_VERIFICATION', 'INFO_REQUESTED', 'RESUBMITTED');--> statement-breakpoint
CREATE INDEX "company_verifications_queue_idx" ON "company_verifications" USING btree ("branch_id","state","sla_due_on");--> statement-breakpoint
CREATE INDEX "company_verifications_verifier_idx" ON "company_verifications" USING btree ("assigned_verifier_id","state");--> statement-breakpoint
CREATE INDEX "verification_history_company_idx" ON "verification_history" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_history_verification_idx" ON "verification_history" USING btree ("verification_id","created_at");--> statement-breakpoint
ALTER TABLE "master_data" ADD CONSTRAINT "master_data_type_valid" CHECK ("master_data"."type" in ('JOB_CATEGORY', 'SKILL', 'EDUCATION_LEVEL', 'LANGUAGE', 'CITY', 'AREA', 'DOCUMENT_TYPE', 'REJECTION_REASON', 'REFUSAL_REASON', 'BLACKLIST_REASON', 'VERIFICATION_REJECTION_REASON', 'WITHDRAWAL_REASON', 'INDUSTRY'));