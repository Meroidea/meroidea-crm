CREATE TABLE "applicant_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applicants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_opening_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"cover_note" text,
	"resume_path" text,
	"resume_name" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"stage" text DEFAULT 'applied' NOT NULL,
	"rating" integer,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_applicants_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "job_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"employment_type" text NOT NULL,
	"location" text,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"public_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_openings_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "applicant_notes" ADD CONSTRAINT "applicant_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_notes" ADD CONSTRAINT "applicant_notes_applicant_fkey" FOREIGN KEY ("tenant_id","applicant_id") REFERENCES "public"."job_applicants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_opening_fkey" FOREIGN KEY ("tenant_id","job_opening_id") REFERENCES "public"."job_openings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applicant_notes_applicant_idx" ON "applicant_notes" USING btree ("tenant_id","applicant_id","created_at");--> statement-breakpoint
CREATE INDEX "job_applicants_opening_idx" ON "job_applicants" USING btree ("tenant_id","job_opening_id","stage") WHERE "job_applicants"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "job_applicants_once_key" ON "job_applicants" USING btree ("tenant_id","job_opening_id",lower("email")) WHERE "job_applicants"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "job_openings_public_token_key" ON "job_openings" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "job_openings_list_idx" ON "job_openings" USING btree ("tenant_id","status") WHERE "job_openings"."deleted_at" is null;