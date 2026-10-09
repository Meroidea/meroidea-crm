-- Finance tables from 0019: tenant isolation, who may read and write, integrity rules and grants
-- for existing workspaces. Applied in the same migrate run as 0019.
-- See docs/database.md §7e and docs/permissions.md.

alter table "invoices" add constraint invoices_due_after_issue check (due_date >= issue_date);
alter table "invoices" add constraint invoices_tax_rate_range check (tax_rate between 0 and 100);
alter table "invoice_lines" add constraint invoice_lines_quantity_positive check (quantity > 0);
alter table "invoice_lines" add constraint invoice_lines_price_not_negative check (unit_price >= 0);
alter table "payslips" add constraint payslips_amounts_sane
  check (minutes >= 0 and gross >= 0 and tax_withheld >= 0 and tax_withheld <= gross
    and net = gross - tax_withheld and super_rate between 0 and 100);
alter table "payslips" add constraint payslips_released_has_time
  check (status <> 'released' or released_at is not null);

-- One employee record per login, so a person's roster shifts map to exactly one pay rate.
create unique index employees_live_user_key on "employees" (tenant_id, user_id)
  where user_id is not null and deleted_at is null;

--> statement-breakpoint

create trigger set_updated_at before update on "invoices"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "payslips"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "invoices" enable row level security;
alter table "invoice_lines" enable row level security;
alter table "payslips" enable row level security;

create policy invoices_manage on "invoices" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'invoices.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'invoices.manage'))
  );
create policy invoice_lines_manage on "invoice_lines" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'invoices.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'invoices.manage'))
  );

-- A payslip is readable by whoever runs payroll, and by the person it belongs to once released.
create policy payslips_read on "payslips" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (select app.has_permission((select app.active_tenant_id()), 'payroll.manage'))
      or (user_id = (select app.user_id()) and status = 'released')
    )
  );
create policy payslips_insert on "payslips" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'payroll.manage'))
  );
create policy payslips_update on "payslips" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'payroll.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'payroll.manage'))
  );

grant select, insert, update on "invoices" to authenticated;
-- A draft's lines are replaced as a set when it is edited.
grant select, insert, delete on "invoice_lines" to authenticated;
grant select, insert, update on "payslips" to authenticated;

--> statement-breakpoint

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('invoices.manage'), ('payroll.manage')) as p(permission)
where r.key = 'owner'
on conflict (role_id, permission) do nothing;
