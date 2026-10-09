-- Roster tables from 0009: tenant isolation, who may write, integrity rules and grants for
-- existing workspaces. Applied in the same migrate run as 0009.
-- See docs/database.md §7a and docs/permissions.md.

alter table "rosters" add constraint rosters_week_or_fortnight
  check (ends_on - starts_on in (6, 13));

alter table "roster_shifts" add constraint roster_shifts_ends_after_start
  check (ends_at > starts_at);
alter table "roster_shifts" add constraint roster_shifts_break_fits
  check (break_minutes >= 0
    and break_minutes * interval '1 minute' < ends_at - starts_at);

--> statement-breakpoint

create trigger set_updated_at before update on "rosters"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "roster_shifts"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "rosters" enable row level security;
alter table "roster_shifts" enable row level security;

-- Unlike the other business tables, the database itself enforces who may write here: only
-- someone holding rosters.manage. A draft is likewise invisible to everyone else until it is
-- published. The service checks the same permission first; this is the wall behind it.
create policy roster_read on "rosters" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      status = 'published'
      or (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
    )
  );
create policy roster_insert on "rosters" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );
create policy roster_update on "rosters" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );

create policy roster_shift_read on "roster_shifts" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
      or exists (
        select 1 from public.rosters r
        where r.id = roster_shifts.roster_id
          and r.tenant_id = roster_shifts.tenant_id
          and r.status = 'published'
          and r.deleted_at is null
      )
    )
  );
create policy roster_shift_insert on "roster_shifts" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );
create policy roster_shift_update on "roster_shifts" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'rosters.manage'))
  );

-- Business records are soft-deleted, so no delete grant.
grant select, insert, update on "rosters" to authenticated;
grant select, insert, update on "roster_shifts" to authenticated;

--> statement-breakpoint

-- Existing workspaces get the grants new ones are provisioned with
-- (src/lib/permissions/catalog.ts): the owner manages rosters, everyone else reads published ones.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('rosters.view'), ('rosters.manage')) as p(permission)
where r.key = 'owner'
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'rosters.view', null
from public.roles r
where r.key in ('manager', 'member', 'support')
on conflict (role_id, permission) do nothing;
