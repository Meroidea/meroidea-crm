CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "public_holidays_tenant_id_day_key" UNIQUE("tenant_id","day")
);
--> statement-breakpoint
CREATE TABLE "roster_team_members" (
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "roster_team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "roster_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'chart-3' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "roster_teams_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "workforce_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"saturday_loading" numeric(4, 2) DEFAULT '1' NOT NULL,
	"sunday_loading" numeric(4, 2) DEFAULT '1' NOT NULL,
	"public_holiday_loading" numeric(4, 2) DEFAULT '1' NOT NULL,
	"break_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "roster_shifts" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD COLUMN "breaks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD COLUMN "auto_breaks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD COLUMN "unpublished_changes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employee_number" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "employees_employee_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 100001 CACHE 1);--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD COLUMN "rate_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "employee_number" integer;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "employer" jsonb;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "employment_type" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "classification" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_team_members" ADD CONSTRAINT "roster_team_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_team_members" ADD CONSTRAINT "roster_team_members_tenant_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."roster_teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_team_members" ADD CONSTRAINT "roster_team_members_tenant_person_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_teams" ADD CONSTRAINT "roster_teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_settings" ADD CONSTRAINT "workforce_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_team_members_person_idx" ON "roster_team_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_tenant_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."roster_teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."roster_shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_employee_number_key" UNIQUE("employee_number");