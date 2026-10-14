CREATE TYPE "public"."custom_entity" AS ENUM('contact', 'organization', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'textarea', 'number', 'date', 'boolean', 'select', 'multi_select', 'email', 'phone', 'url');--> statement-breakpoint
CREATE TYPE "public"."lead_reason_kind" AS ENUM('disqualify', 'reject');--> statement-breakpoint
CREATE TYPE "public"."lead_status_kind" AS ENUM('new', 'working', 'pending_acceptance', 'returned', 'converted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."lead_type" AS ENUM('b2b', 'b2c');--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'status_changed';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'assigned';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'handover';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'handover_accepted';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'handover_rejected';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'converted';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'merged';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'approval';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'enquiry';--> statement-breakpoint
CREATE TABLE "contact_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"related_contact_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_links_pair_key" UNIQUE("tenant_id","contact_id","related_contact_id")
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" "custom_entity" NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"field_type" "custom_field_type" NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"show_in_list" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_definitions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "custom_field_definitions_key" UNIQUE("tenant_id","entity_type","key")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"source_id" uuid,
	"sub_source_id" uuid,
	"campaign_name" text,
	"lead_type" "lead_type",
	"duplicate_strategy" text DEFAULT 'skip' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"merged_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"duplicate_created_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "import_batches_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "lead_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "lead_reason_kind" NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_reasons_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "lead_reasons_name_key" UNIQUE("tenant_id","kind","name")
);
--> statement-breakpoint
CREATE TABLE "lead_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "lead_status_kind" NOT NULL,
	"lead_type" "lead_type",
	"requires_reason" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_statuses_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "lead_sub_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sub_sources_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "lead_sub_sources_source_id_key" UNIQUE("tenant_id","source_id","id"),
	CONSTRAINT "lead_sub_sources_name_key" UNIQUE("tenant_id","source_id","name")
);
--> statement-breakpoint
CREATE TABLE "opportunity_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_contacts_key" UNIQUE("tenant_id","opportunity_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "stage_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "stage_approvals_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"assigned_to" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"enrolled_by" uuid,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "sequence_enrollments_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequences_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "email_templates_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "lead_intake_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"web_form_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"contact_id" uuid,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"dedupe_key" text,
	"email_wanted" boolean DEFAULT false NOT NULL,
	"emailed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key" UNIQUE("tenant_id","user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"stage" text DEFAULT 'intake' NOT NULL,
	"lead_type" "lead_type",
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"method" text DEFAULT 'round_robin' NOT NULL,
	"user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"team_id" uuid,
	"last_assigned_user_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_rules_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "web_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"source_id" uuid NOT NULL,
	"sub_source_id" uuid,
	"lead_type" "lead_type" DEFAULT 'b2c' NOT NULL,
	"thank_you_message" text,
	"ask_company" boolean DEFAULT false NOT NULL,
	"ask_message" boolean DEFAULT true NOT NULL,
	"ask_consent" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_forms_publicKey_unique" UNIQUE("public_key"),
	CONSTRAINT "web_forms_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lead_type" "lead_type";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lead_status_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lead_status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lead_reason_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lead_reason_note" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sub_source_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "campaign_name" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "utm" jsonb;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "company_website" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "company_size" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "interest" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "originator_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "first_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "handover_to_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "handover_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "handover_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "handover_meeting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "handover_summary" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "rejected_reason_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "rejected_note" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "do_not_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "do_not_call" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "consent_source" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "company_size" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "sub_source_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "originator_user_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "product" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "probability" smallint;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "next_step" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "checklist_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "owner_team_id" uuid;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "on_enter" text DEFAULT 'notify' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "last_assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "required_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "lead_type" "lead_type";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sequence_enrollment_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_links" ADD CONSTRAINT "contact_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_links" ADD CONSTRAINT "contact_links_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_links" ADD CONSTRAINT "contact_links_tenant_related_fk" FOREIGN KEY ("tenant_id","related_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."lead_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_sub_source_fk" FOREIGN KEY ("tenant_id","sub_source_id") REFERENCES "public"."lead_sub_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_reasons" ADD CONSTRAINT "lead_reasons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_statuses" ADD CONSTRAINT "lead_statuses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sub_sources" ADD CONSTRAINT "lead_sub_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sub_sources" ADD CONSTRAINT "lead_sub_sources_tenant_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."lead_sources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_tenant_opportunity_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvals" ADD CONSTRAINT "stage_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvals" ADD CONSTRAINT "stage_approvals_tenant_opportunity_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvals" ADD CONSTRAINT "stage_approvals_tenant_stage_fk" FOREIGN KEY ("tenant_id","stage_id") REFERENCES "public"."pipeline_stages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_tenant_sequence_fk" FOREIGN KEY ("tenant_id","sequence_id") REFERENCES "public"."sequences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_tenant_assignee_fk" FOREIGN KEY ("tenant_id","assigned_to") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_intake_events" ADD CONSTRAINT "lead_intake_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_intake_events" ADD CONSTRAINT "lead_intake_events_tenant_form_fk" FOREIGN KEY ("tenant_id","web_form_id") REFERENCES "public"."web_forms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_intake_events" ADD CONSTRAINT "lead_intake_events_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_tenant_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_forms" ADD CONSTRAINT "web_forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_forms" ADD CONSTRAINT "web_forms_tenant_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."lead_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_forms" ADD CONSTRAINT "web_forms_tenant_sub_source_fk" FOREIGN KEY ("tenant_id","source_id","sub_source_id") REFERENCES "public"."lead_sub_sources"("tenant_id","source_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_links_related_idx" ON "contact_links" USING btree ("tenant_id","related_contact_id");--> statement-breakpoint
CREATE INDEX "import_batches_tenant_created_idx" ON "import_batches" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_statuses_tenant_position_idx" ON "lead_statuses" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "opportunity_contacts_contact_idx" ON "opportunity_contacts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "stage_approvals_pending_idx" ON "stage_approvals" USING btree ("tenant_id","status","requested_at") WHERE "stage_approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "sequence_enrollments_contact_idx" ON "sequence_enrollments" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "lead_intake_events_tenant_received_idx" ON "lead_intake_events" USING btree ("tenant_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("tenant_id","user_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_email_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."email_wanted" and "notifications"."emailed_at" is null;--> statement-breakpoint
CREATE INDEX "routing_rules_order_idx" ON "routing_rules" USING btree ("tenant_id","stage","position");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_sub_source_fk" FOREIGN KEY ("tenant_id","source_id","sub_source_id") REFERENCES "public"."lead_sub_sources"("tenant_id","source_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_lead_status_fk" FOREIGN KEY ("tenant_id","lead_status_id") REFERENCES "public"."lead_statuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_lead_reason_fk" FOREIGN KEY ("tenant_id","lead_reason_id") REFERENCES "public"."lead_reasons"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_rejected_reason_fk" FOREIGN KEY ("tenant_id","rejected_reason_id") REFERENCES "public"."lead_reasons"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_import_batch_fk" FOREIGN KEY ("tenant_id","import_batch_id") REFERENCES "public"."import_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_originator_fk" FOREIGN KEY ("tenant_id","originator_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_handover_to_fk" FOREIGN KEY ("tenant_id","handover_to_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_sub_source_fk" FOREIGN KEY ("tenant_id","sub_source_id") REFERENCES "public"."lead_sub_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_originator_fk" FOREIGN KEY ("tenant_id","originator_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_team_fk" FOREIGN KEY ("tenant_id","owner_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_sequence_enrollment_fk" FOREIGN KEY ("tenant_id","sequence_enrollment_id") REFERENCES "public"."sequence_enrollments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_lead_queue_idx" ON "contacts" USING btree ("tenant_id","lead_status_id","created_at" DESC NULLS LAST) WHERE "contacts"."deleted_at" is null and "contacts"."lead_status_id" is not null;--> statement-breakpoint
CREATE INDEX "contacts_handover_idx" ON "contacts" USING btree ("tenant_id","handover_to_user_id") WHERE "contacts"."deleted_at" is null and "contacts"."handover_to_user_id" is not null;--> statement-breakpoint
CREATE INDEX "organizations_tenant_domain_idx" ON "organizations" USING btree ("tenant_id","domain") WHERE "organizations"."deleted_at" is null and "organizations"."domain" is not null;