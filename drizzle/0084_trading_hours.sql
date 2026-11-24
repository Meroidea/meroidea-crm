CREATE TABLE "trading_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time,
	"closes_at" time,
	"staff_needed" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "trading_hours_tenant_weekday_key" UNIQUE("tenant_id","weekday"),
	CONSTRAINT "trading_hours_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "trading_hours_weekday_check" CHECK ("trading_hours"."weekday" between 0 and 6),
	CONSTRAINT "trading_hours_times_check" CHECK (("trading_hours"."opens_at" is null) = ("trading_hours"."closes_at" is null)),
	CONSTRAINT "trading_hours_staff_check" CHECK ("trading_hours"."staff_needed" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "trading_hours" ADD CONSTRAINT "trading_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Trading hours (ADR-076): business-wide, so no feature switch. Everyone in the business may read
-- them (opening hours are no secret to staff, and the roster uses them); only someone who manages
-- the business's settings may change them. The platform owner writes them at onboarding through
-- src/modules/platform/service.ts.
alter table "trading_hours" enable row level security;
--> statement-breakpoint
create policy trading_hours_read on "trading_hours"
  for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
--> statement-breakpoint
create policy trading_hours_write on "trading_hours"
  for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'settings.manage')))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'settings.manage')));
--> statement-breakpoint
grant select, insert, update, delete on "trading_hours" to authenticated;
