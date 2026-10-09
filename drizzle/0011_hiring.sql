CREATE TYPE "public"."contract_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('pending', 'active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'casual', 'fixed_term', 'contractor');--> statement-breakpoint
CREATE TYPE "public"."pay_basis" AS ENUM('hourly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."rate_source" AS ENUM('fair_work', 'manual', 'none');--> statement-breakpoint
CREATE TABLE "employee_payroll_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"tax_file_number_ciphertext" text,
	"tax_resident" boolean,
	"claims_tax_free_threshold" boolean,
	"has_study_loan" boolean,
	"bank_account_name" text,
	"bank_bsb_ciphertext" text,
	"bank_account_ciphertext" text,
	"bank_account_last3" text,
	"super_fund_name" text,
	"super_fund_usi" text,
	"super_member_ciphertext" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_payroll_details_employee_key" UNIQUE("tenant_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"status" "employee_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "employees_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "employment_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_type" "employment_type" NOT NULL,
	"position_title" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"hours_per_week" numeric(5, 2),
	"pay_basis" "pay_basis" NOT NULL,
	"pay_rate" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"award_code" text,
	"award_name" text,
	"classification" text,
	"classification_ref" text,
	"minimum_rate" numeric(14, 2),
	"rate_source" "rate_source" DEFAULT 'none' NOT NULL,
	"below_minimum_reason" text,
	"contractor_abn" text,
	"probation_months" integer,
	"body" text,
	"statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"viewed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_name" text,
	"accepted_ip" text,
	"accepted_user_agent" text,
	"declined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "employment_contracts_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "employee_payroll_details" ADD CONSTRAINT "employee_payroll_details_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payroll_details" ADD CONSTRAINT "employee_payroll_details_tenant_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_tenant_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_tenant_status_idx" ON "employees" USING btree ("tenant_id","status") WHERE "employees"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "employment_contracts_employee_idx" ON "employment_contracts" USING btree ("tenant_id","employee_id");