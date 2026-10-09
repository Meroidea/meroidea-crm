-- Sales and work tables from 0007: tenant isolation, grants, integrity rules and starting
-- configuration for existing workspaces. Applied in the same migrate run as 0007.
-- See docs/database.md §4, §5, §7, §11.

create unique index pipelines_one_default_key on "pipelines" (tenant_id, object_type)
  where is_default;

-- One open visit per opportunity: the current stage.
create unique index stage_history_one_open_visit_key on "stage_history" (opportunity_id)
  where exited_at is null;

alter table "opportunities" add constraint opportunities_lost_needs_reason
  check (status <> 'lost' or lost_reason_id is not null);

alter table "activities" add constraint activities_needs_a_record
  check (num_nonnulls(contact_id, opportunity_id, organization_id) >= 1);

alter table "pipeline_stages" add constraint pipeline_stages_probability_range
  check (probability is null or probability between 0 and 100);

--> statement-breakpoint

create trigger set_updated_at before update on "pipelines"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "pipeline_stages"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "lost_reasons"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "partners"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "opportunities"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "tasks"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "activities"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "pipelines" enable row level security;
alter table "pipeline_stages" enable row level security;
alter table "lost_reasons" enable row level security;
alter table "partners" enable row level security;
alter table "opportunities" enable row level security;
alter table "stage_history" enable row level security;
alter table "tasks" enable row level security;
alter table "activities" enable row level security;

create policy tenant_isolation on "pipelines" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy tenant_isolation on "pipeline_stages" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy tenant_isolation on "lost_reasons" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy tenant_isolation on "partners" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy tenant_isolation on "opportunities" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy tenant_isolation on "stage_history" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy tenant_isolation on "tasks" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy tenant_isolation on "activities" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

-- Configuration lists are edited and reordered in place.
grant select, insert, update, delete on "pipelines" to authenticated;
grant select, insert, update, delete on "pipeline_stages" to authenticated;
grant select, insert, update, delete on "lost_reasons" to authenticated;
-- Business records are soft-deleted; stage history is written, closed, never removed.
grant select, insert, update on "partners" to authenticated;
grant select, insert, update on "opportunities" to authenticated;
grant select, insert, update on "stage_history" to authenticated;
grant select, insert, update on "tasks" to authenticated;
grant select, insert, update on "activities" to authenticated;

--> statement-breakpoint

-- Existing workspaces get the same neutral pipeline and lost reasons new ones are provisioned
-- with (src/lib/tenant/defaults.ts).
insert into public.pipelines (tenant_id, name, object_type, is_default, position)
select t.id, 'Sales', 'opportunity', true, 0
from public.tenants t
where not exists (
  select 1 from public.pipelines p where p.tenant_id = t.id and p.object_type = 'opportunity'
);

insert into public.pipeline_stages
  (tenant_id, pipeline_id, name, position, category, probability, color, stale_after_days)
select p.tenant_id, p.id, s.name, s.position, s.category::public.stage_category, s.probability,
       s.color, s.stale
from public.pipelines p
cross join (values
  ('New', 0, 'open', 10, 'chart-2', 3),
  ('Contacted', 1, 'open', 20, 'chart-3', 7),
  ('Qualified', 2, 'open', 40, 'info', 7),
  ('Proposal', 3, 'open', 60, 'chart-4', 10),
  ('Negotiation', 4, 'open', 80, 'chart-1', 10),
  ('Won', 5, 'won', 100, 'positive', null),
  ('Lost', 6, 'lost', 0, 'destructive', null)
) as s(name, position, category, probability, color, stale)
where p.object_type = 'opportunity' and p.is_default
  and not exists (select 1 from public.pipeline_stages x where x.pipeline_id = p.id);

insert into public.lost_reasons (tenant_id, name, position)
select t.id, r.name, r.position
from public.tenants t
cross join (values
  ('Price', 0),
  ('Chose a competitor', 1),
  ('No response', 2),
  ('Not a fit', 3),
  ('Timing', 4),
  ('Other', 5)
) as r(name, position)
on conflict (tenant_id, name) do nothing;
