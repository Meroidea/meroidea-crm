CREATE TYPE "public"."contact_status" AS ENUM('active', 'inactive', 'do_not_contact');--> statement-breakpoint
CREATE TYPE "public"."lead_source_type" AS ENUM('manual', 'web_form', 'social', 'referral', 'partner', 'walk_in', 'import', 'api', 'other');--> statement-breakpoint
CREATE TABLE "contact_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_organizations_link_key" UNIQUE("tenant_id","contact_id","organization_id","relationship")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"full_name" text GENERATED ALWAYS AS (trim(first_name || ' ' || coalesce(last_name, ''))) STORED,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"phone_e164" text,
	"alt_phone" text,
	"date_of_birth" date,
	"gender" text,
	"address_line" text,
	"city" text,
	"region" text,
	"country" char(2),
	"status" "contact_status" DEFAULT 'active' NOT NULL,
	"owner_user_id" uuid,
	"source_id" uuid,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"consent_updated_at" timestamp with time zone,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_activity_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contacts_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "lead_source_type" DEFAULT 'manual' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "lead_sources_tenant_id_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"email" text,
	"phone" text,
	"website" text,
	"address_line" text,
	"city" text,
	"region" text,
	"country" char(2),
	"owner_user_id" uuid,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "contact_organizations" ADD CONSTRAINT "contact_organizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_organizations" ADD CONSTRAINT "contact_organizations_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_organizations" ADD CONSTRAINT "contact_organizations_tenant_organization_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."lead_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_organizations_org_idx" ON "contact_organizations" USING btree ("tenant_id","organization_id");--> statement-breakpoint
CREATE INDEX "contacts_tenant_owner_idx" ON "contacts" USING btree ("tenant_id","owner_user_id") WHERE "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contacts_tenant_created_idx" ON "contacts" USING btree ("tenant_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contacts_tenant_email_idx" ON "contacts" USING btree ("tenant_id","email_normalized") WHERE "contacts"."deleted_at" is null and "contacts"."email_normalized" is not null;--> statement-breakpoint
CREATE INDEX "contacts_tenant_phone_idx" ON "contacts" USING btree ("tenant_id","phone_e164") WHERE "contacts"."deleted_at" is null and "contacts"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "contacts_search_idx" ON "contacts" USING gin ("search");--> statement-breakpoint
CREATE INDEX "contacts_custom_fields_idx" ON "contacts" USING gin ("custom_fields" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "organizations_tenant_name_idx" ON "organizations" USING btree ("tenant_id","name") WHERE "organizations"."deleted_at" is null;