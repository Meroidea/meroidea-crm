CREATE TABLE "concern_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"concern_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concern_messages_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "concerns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_with" text NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concerns_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "concern_messages" ADD CONSTRAINT "concern_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concern_messages" ADD CONSTRAINT "concern_messages_concern_fk" FOREIGN KEY ("tenant_id","concern_id") REFERENCES "public"."concerns"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concerns" ADD CONSTRAINT "concerns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concern_messages_concern_idx" ON "concern_messages" USING btree ("tenant_id","concern_id","created_at");--> statement-breakpoint
CREATE INDEX "concerns_tenant_activity_idx" ON "concerns" USING btree ("tenant_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "concerns_tenant_raised_by_idx" ON "concerns" USING btree ("tenant_id","raised_by");--> statement-breakpoint
-- Staff concerns (ADR-049): rules, who may read and answer, the feature switch, and grants for
-- existing businesses' roles. See docs/database.md §7n.
alter table "concerns" add constraint concerns_raised_with_known
  check (raised_with in ('manager', 'admin'));
alter table "concerns" add constraint concerns_status_known
  check (status in ('open', 'in_progress', 'resolved'));
alter table "concerns" add constraint concerns_category_known
  check (category in ('roster', 'pay', 'workplace', 'safety', 'conduct', 'other'));
alter table "concerns" add constraint concerns_subject_length
  check (char_length(subject) between 3 and 150);
alter table "concerns" add constraint concerns_resolved_consistent
  check ((status = 'resolved') = (resolved_at is not null));
alter table "concern_messages" add constraint concern_messages_body_length
  check (char_length(body) between 1 and 5000);

create trigger set_updated_at before update on "concerns"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

-- A reply moves its concern up the list. Security definer because the person replying (often
-- the one who raised it) may not update concerns themselves.
create function app.touch_concern() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.concerns
  set last_activity_at = new.created_at
  where tenant_id = new.tenant_id and id = new.concern_id;
  return new;
end;
$$;

create trigger touch_concern after insert on "concern_messages"
  for each row execute function app.touch_concern();

--> statement-breakpoint

alter table "concerns" enable row level security;
alter table "concern_messages" enable row level security;

-- Readable by the person who raised it; by the admin (concerns.handle_all); and by managers
-- (concerns.handle) only when it was raised with a manager. One raised with the admin never
-- reaches a manager.
create policy concerns_read on "concerns" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      raised_by = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'concerns.handle_all'))
      or (
        raised_with = 'manager'
        and (select app.has_permission((select app.active_tenant_id()), 'concerns.handle'))
      )
    )
  );
create policy concerns_insert on "concerns" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and raised_by = (select app.user_id())
    and status = 'open'
    and (select app.has_permission((select app.active_tenant_id()), 'concerns.raise'))
  );
-- Only those who answer it change its status, and never on a concern they raised themselves.
create policy concerns_update on "concerns" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and raised_by <> (select app.user_id())
    and (
      (select app.has_permission((select app.active_tenant_id()), 'concerns.handle_all'))
      or (
        raised_with = 'manager'
        and (select app.has_permission((select app.active_tenant_id()), 'concerns.handle'))
      )
    )
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
  );

-- Messages follow their concern: the subquery is itself filtered by concerns_read.
create policy concern_messages_read on "concern_messages" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and exists (
      select 1 from public.concerns c
      where c.tenant_id = concern_messages.tenant_id and c.id = concern_messages.concern_id
    )
  );
create policy concern_messages_insert on "concern_messages" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and author_user_id = (select app.user_id())
    and exists (
      select 1 from public.concerns c
      where c.tenant_id = concern_messages.tenant_id and c.id = concern_messages.concern_id
        and c.status <> 'resolved'
    )
  );

-- Owned by one feature: hidden entirely while it is switched off (ADR-038).
create policy feature_switch on "concerns" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'concerns')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'concerns')));
create policy feature_switch on "concern_messages" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'concerns')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'concerns')));

-- What a concern says and whom it was raised with never change after it is raised.
grant select, insert on "concerns" to authenticated;
grant update (status, resolved_at, resolved_by) on "concerns" to authenticated;
grant select, insert on "concern_messages" to authenticated;

--> statement-breakpoint

-- The new permission family belongs to the new feature. Mirrors FAMILY_FEATURE in
-- src/lib/features.ts; tests/db/hardening.test.ts fails if the two drift apart.
create or replace function app.permission_feature(perm text) returns text
language sql immutable set search_path = '' as $$
  select case split_part(perm, '.', 1)
    when 'contacts' then 'crm'
    when 'opportunities' then 'crm'
    when 'revenue' then 'crm'
    when 'activities' then 'crm'
    when 'documents' then 'crm'
    when 'partners' then 'crm'
    when 'organizations' then 'crm'
    when 'products' then 'crm'
    when 'reports' then 'crm'
    when 'tasks' then 'tasks'
    when 'rosters' then 'roster'
    when 'timeoff' then 'timeoff'
    when 'timesheets' then 'timesheets'
    when 'employees' then 'staff'
    when 'recruitment' then 'recruitment'
    when 'reviews' then 'reviews'
    when 'tickets' then 'helpdesk'
    when 'projects' then 'projects'
    when 'productivity' then 'productivity'
    when 'inventory' then 'inventory'
    when 'purchasing' then 'purchasing'
    when 'files' then 'files'
    when 'invoices' then 'invoices'
    when 'expenses' then 'expenses'
    when 'payroll' then 'payroll'
    when 'concerns' then 'concerns'
    else null
  end;
$$;

--> statement-breakpoint

-- Existing businesses' roles get the same grants a new business's do. The feature itself stays
-- off until the platform owner switches it on for a business (ADR-029).
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('concerns.raise'), ('concerns.handle'), ('concerns.handle_all')) as p(permission)
where r.key = 'owner'
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('concerns.raise'), ('concerns.handle')) as p(permission)
where r.key = 'manager'
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'concerns.raise', null
from public.roles r
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;
