CREATE TABLE "job_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"company_location_id" uuid,
	"address_line" text NOT NULL,
	"city_code" text NOT NULL,
	"location" geography(Point, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_requirements" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"education_level_code" text,
	"min_experience_years" smallint,
	"language_codes" text[],
	"other_requirements" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_skills" (
	"job_id" uuid NOT NULL,
	"skill_code" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"min_level" text DEFAULT 'BEGINNER' NOT NULL,
	CONSTRAINT "job_skills_job_id_skill_code_pk" PRIMARY KEY("job_id","skill_code")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category_code" text NOT NULL,
	"description" text NOT NULL,
	"job_type" text NOT NULL,
	"shift" text NOT NULL,
	"gender_preference" text DEFAULT 'ANY' NOT NULL,
	"vacancies" smallint NOT NULL,
	"vacancies_filled" smallint DEFAULT 0 NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"closes_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_salary_order" CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max),
	CONSTRAINT "jobs_vacancies_positive" CHECK (vacancies > 0),
	CONSTRAINT "jobs_filled_lte_vacancies" CHECK (vacancies_filled <= vacancies)
);
--> statement-breakpoint
ALTER TABLE "company_verifications" ADD COLUMN "info_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "job_locations_job_idx" ON "job_locations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_locations_gist_idx" ON "job_locations" USING gist ("location");--> statement-breakpoint
CREATE INDEX "job_skills_job_idx" ON "job_skills" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "jobs_branch_status_idx" ON "jobs" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "jobs_category_idx" ON "jobs" USING btree ("category_code");