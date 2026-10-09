-- Time off from 0026: rules, tenant isolation, who may see and decide, and grants for existing
-- workspaces. Applied in the same migrate run as 0026. See docs/database.md §7g.

alter table "leave_requests" add constraint leave_requests_dates_ordered
  check (ends_on >= starts_on);
alter table "leave_requests" add constraint leave_requests_days_positive
  check (days > 0);
alter table "leave_requests" add constraint leave_requests_status_known
  check (status in ('pending', 'approved', 'declined', 'cancelled'));

--> statement-breakpoint

create trigger set_updated_at before update on "leave_types"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "leave_requests"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "leave_types" enable row level security;
alter table "leave_requests" enable row level security;

create policy leave_types_read on "leave_types" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy leave_types_insert on "leave_types" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'timeoff.manage'))
  );
create policy leave_types_update on "leave_types" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'timeoff.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'timeoff.manage'))
  );

-- A person sees their own requests; people who manage time off see everyone's.
create policy leave_requests_read on "leave_requests" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'timeoff.manage'))
    )
  );
create policy leave_requests_insert on "leave_requests" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and status = 'pending'
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'timeoff.manage'))
    )
  );
-- The person may only withdraw their own request; deciding it needs timeoff.manage.
create policy leave_requests_update on "leave_requests" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'timeoff.manage'))
    )
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (user_id = (select app.user_id()) and status = 'cancelled')
      or (select app.has_permission((select app.active_tenant_id()), 'timeoff.manage'))
    )
  );

grant select, insert, update on "leave_types" to authenticated;
grant select, insert, update on "leave_requests" to authenticated;

--> statement-breakpoint

-- Existing businesses get the feature, the grants and the starting leave types.
update public.tenants set features = array_append(features, 'timeoff')
where not ('timeoff' = any(features));

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('timeoff.request'), ('timeoff.manage')) as p(permission)
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'timeoff.request', null
from public.roles r
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;

insert into public.leave_types (tenant_id, name, is_paid)
select t.id, d.name, d.is_paid
from public.tenants t
cross join (values ('Annual leave', true), ('Sick leave', true), ('Unpaid leave', false)) as d(name, is_paid)
on conflict (tenant_id, name) do nothing;
