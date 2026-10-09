-- Departments from 0013: tenant isolation limited to people who manage employees, and integrity
-- rules. Applied in the same migrate run as 0013. See docs/database.md §7b.

-- One live department per name, compared without regard to case.
create unique index departments_live_name_key on "departments" (tenant_id, lower(name))
  where deleted_at is null;

alter table "employees" add constraint employees_ended_has_date
  check (status <> 'ended' or ended_on is not null);

--> statement-breakpoint

create trigger set_updated_at before update on "departments"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "departments" enable row level security;

create policy departments_manage on "departments" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'employees.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'employees.manage'))
  );

grant select, insert, update on "departments" to authenticated;
