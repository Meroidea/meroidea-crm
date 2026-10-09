-- Timesheets from 0028: rules, tenant isolation, who may see and approve, and grants for
-- existing workspaces. Applied in the same migrate run as 0028. See docs/database.md §7h.

alter table "time_entries" add constraint time_entries_out_after_in
  check (clock_out is null or clock_out > clock_in);
alter table "time_entries" add constraint time_entries_break_sane
  check (break_minutes >= 0 and break_minutes <= 720);
alter table "time_entries" add constraint time_entries_status_known
  check (status in ('pending', 'approved', 'rejected'));
alter table "time_entries" add constraint time_entries_source_known
  check (source in ('clock', 'manual'));
-- Nothing still running can be approved.
alter table "time_entries" add constraint time_entries_approved_is_finished
  check (status <> 'approved' or clock_out is not null);

--> statement-breakpoint

create trigger set_updated_at before update on "time_entries"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "time_entries" enable row level security;

-- A person sees their own time; people who manage timesheets see everyone's.
create policy time_entries_read on "time_entries" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'timesheets.manage'))
    )
  );
create policy time_entries_insert on "time_entries" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (user_id = (select app.user_id()) and status = 'pending')
      or (select app.has_permission((select app.active_tenant_id()), 'timesheets.manage'))
    )
  );
-- A person may change their own entry only while it is waiting, and can never approve it.
create policy time_entries_update on "time_entries" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (user_id = (select app.user_id()) and status = 'pending')
      or (select app.has_permission((select app.active_tenant_id()), 'timesheets.manage'))
    )
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (user_id = (select app.user_id()) and status = 'pending')
      or (select app.has_permission((select app.active_tenant_id()), 'timesheets.manage'))
    )
  );

grant select, insert, update on "time_entries" to authenticated;

--> statement-breakpoint

update public.tenants set features = array_append(features, 'timesheets')
where not ('timesheets' = any(features));

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('timesheets.clock'), ('timesheets.manage')) as p(permission)
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'timesheets.clock', null
from public.roles r
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;
