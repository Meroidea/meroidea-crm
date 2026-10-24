ALTER TYPE "public"."custom_entity" ADD VALUE 'opportunity_item';--> statement-breakpoint
CREATE TABLE "opportunity_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" "opportunity_status" DEFAULT 'open' NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"lost_reason_id" uuid,
	"lost_reason_note" text,
	"external_reference" text,
	"base_amount" numeric(14, 2),
	"revenue_rate" numeric(7, 4),
	"expected_revenue" numeric(14, 2),
	"currency" char(3),
	"owner_user_id" uuid,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "opportunity_items_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "advances_parent_to_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "item_pipeline_id" uuid;--> statement-breakpoint
ALTER TABLE "stage_history" ADD COLUMN "opportunity_item_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_tenant_opportunity_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_tenant_organization_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_tenant_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_tenant_stage_fk" FOREIGN KEY ("tenant_id","stage_id") REFERENCES "public"."pipeline_stages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_tenant_lost_reason_fk" FOREIGN KEY ("tenant_id","lost_reason_id") REFERENCES "public"."lost_reasons"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_tenant_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_items_opportunity_idx" ON "opportunity_items" USING btree ("tenant_id","opportunity_id") WHERE "opportunity_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "opportunity_items_organization_idx" ON "opportunity_items" USING btree ("tenant_id","organization_id","status");--> statement-breakpoint
CREATE INDEX "opportunity_items_stage_idx" ON "opportunity_items" USING btree ("tenant_id","pipeline_id","stage_id") WHERE "opportunity_items"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_advances_parent_fk" FOREIGN KEY ("tenant_id","advances_parent_to_stage_id") REFERENCES "public"."pipeline_stages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_item_pipeline_fk" FOREIGN KEY ("tenant_id","item_pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_tenant_item_fk" FOREIGN KEY ("tenant_id","opportunity_item_id") REFERENCES "public"."opportunity_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_history_item_idx" ON "stage_history" USING btree ("tenant_id","opportunity_item_id","entered_at") WHERE "stage_history"."opportunity_item_id" is not null;--> statement-breakpoint

-- Opportunity items (ADR-018, milestone 8): rules, one open stage visit per opportunity and per
-- item, row-level security, the CRM feature switch and grants. See docs/database.md §4.
alter table "opportunity_items" add constraint opportunity_items_lost_needs_reason
  check (status <> 'lost' or lost_reason_id is not null);
alter table "opportunity_items" add constraint opportunity_items_title_length
  check (char_length(title) between 1 and 200);
alter table "opportunity_items" add constraint opportunity_items_external_reference_length
  check (external_reference is null or char_length(external_reference) <= 100);
alter table "opportunity_items" add constraint opportunity_items_lost_reason_note_length
  check (lost_reason_note is null or char_length(lost_reason_note) <= 1000);
alter table "opportunity_items" add constraint opportunity_items_amounts_not_negative
  check ((base_amount is null or base_amount >= 0)
     and (expected_revenue is null or expected_revenue >= 0));
alter table "opportunity_items" add constraint opportunity_items_rate_range
  check (revenue_rate is null or revenue_rate between 0 and 100);
alter table "opportunity_items" add constraint opportunity_items_money_has_currency
  check ((base_amount is null and expected_revenue is null) or currency is not null);
alter table "pipelines" add constraint pipelines_item_pipeline_only_on_opportunities
  check (item_pipeline_id is null or object_type = 'opportunity');

-- An item's visits share its opportunity's id, so "one open visit" is per opportunity for the
-- opportunity's own stage and per item for each item's stage.
drop index stage_history_one_open_visit_key;
create unique index stage_history_one_open_visit_key on "stage_history" (opportunity_id)
  where exited_at is null and opportunity_item_id is null;
create unique index stage_history_one_open_item_visit_key on "stage_history" (opportunity_item_id)
  where exited_at is null and opportunity_item_id is not null;

create trigger set_updated_at before update on "opportunity_items"
  for each row execute function app.set_updated_at();

-- Tenant isolation; the service checks the parent opportunity's permission and record scope.
alter table "opportunity_items" enable row level security;
create policy tenant_isolation on "opportunity_items" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
-- Part of the CRM feature (ADR-038).
create policy feature_switch on "opportunity_items" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'crm')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'crm')));

-- Soft delete only: no delete grant.
grant select, insert, update on "opportunity_items" to authenticated;
