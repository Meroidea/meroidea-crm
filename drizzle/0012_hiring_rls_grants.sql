-- Hiring tables from 0011: tenant isolation, who may read and write, integrity rules and grants
-- for existing workspaces. Applied in the same migrate run as 0011.
-- See docs/database.md §7b and docs/permissions.md.

alter table "employment_contracts" add constraint employment_contracts_pay_positive
  check (pay_rate > 0);
alter table "employment_contracts" add constraint employment_contracts_dates_in_order
  check (end_date is null or end_date >= start_date);
alter table "employment_contracts" add constraint employment_contracts_hours_range
  check (hours_per_week is null or (hours_per_week > 0 and hours_per_week <= 168));
-- A contract that has left draft must carry the wording the person was shown.
alter table "employment_contracts" add constraint employment_contracts_sent_has_body
  check (status = 'draft' or body is not null);

--> statement-breakpoint

create trigger set_updated_at before update on "employees"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "employment_contracts"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "employee_payroll_details"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "employees" enable row level security;
alter table "employment_contracts" enable row level security;
alter table "employee_payroll_details" enable row level security;

-- Employment records are personal and commercially sensitive, so the database itself limits
-- them to people holding employees.manage, as well as the service checking it.
create policy employees_manage on "employees" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'employees.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'employees.manage'))
  );
create policy employment_contracts_manage on "employment_contracts" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'employees.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'employees.manage'))
  );

-- Tax, bank and super details: read-only for signed-in users, and only with
-- employees.view_sensitive. They are written by the new hire through their one-time link
-- (src/modules/hiring/public.ts), never by a signed-in user.
create policy employee_payroll_details_read on "employee_payroll_details" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'employees.view_sensitive'))
  );

grant select, insert, update on "employees" to authenticated;
grant select, insert, update on "employment_contracts" to authenticated;
grant select on "employee_payroll_details" to authenticated;

--> statement-breakpoint

-- Existing workspaces get the grants new ones are provisioned with: the owner only.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('employees.manage'), ('employees.view_sensitive')) as p(permission)
where r.key = 'owner'
on conflict (role_id, permission) do nothing;
