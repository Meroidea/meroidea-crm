CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"clock_in" timestamp with time zone NOT NULL,
	"clock_out" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"note" text,
	"source" text DEFAULT 'clock' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_person_idx" ON "time_entries" USING btree ("tenant_id","user_id","clock_in") WHERE "time_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "time_entries_period_idx" ON "time_entries" USING btree ("tenant_id","clock_in") WHERE "time_entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_one_open_key" ON "time_entries" USING btree ("tenant_id","user_id") WHERE "time_entries"."clock_out" is null and "time_entries"."deleted_at" is null;