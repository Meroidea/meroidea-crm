-- Expenses from 0030: rules, tenant isolation, who may see and decide, and grants for existing
-- workspaces. Applied in the same migrate run as 0030. See docs/database.md §7i.

alter table "expense_claims" add constraint expense_claims_amount_positive check (amount > 0);
alter table "expense_claims" add constraint expense_claims_status_known
  check (status in ('submitted', 'approved', 'declined', 'reimbursed'));

--> statement-breakpoint

create trigger set_updated_at before update on "expense_claims"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "expense_claims" enable row level security;

create policy expense_claims_read on "expense_claims" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'expenses.manage'))
    )
  );
create policy expense_claims_insert on "expense_claims" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select app.user_id())
    and status = 'submitted'
  );
-- A person may change or withdraw their own claim only before it is decided.
create policy expense_claims_update on "expense_claims" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (user_id = (select app.user_id()) and status = 'submitted')
      or (select app.has_permission((select app.active_tenant_id()), 'expenses.manage'))
    )
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (user_id = (select app.user_id()) and status = 'submitted')
      or (select app.has_permission((select app.active_tenant_id()), 'expenses.manage'))
    )
  );

grant select, insert, update on "expense_claims" to authenticated;

--> statement-breakpoint

update public.tenants set features = array_append(features, 'expenses')
where not ('expenses' = any(features));

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('expenses.submit'), ('expenses.manage')) as p(permission)
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'expenses.submit', null
from public.roles r
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;
