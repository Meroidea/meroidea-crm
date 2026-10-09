-- Inventory tables from 0015: tenant isolation, who may write, integrity rules and grants for
-- existing workspaces. Applied in the same migrate run as 0015.
-- See docs/database.md §7c and docs/permissions.md.

alter table "inventory_items" add constraint inventory_items_quantity_not_negative
  check (quantity_on_hand >= 0);
alter table "inventory_items" add constraint inventory_items_reorder_not_negative
  check (reorder_level is null or reorder_level >= 0);
alter table "inventory_items" add constraint inventory_items_cost_not_negative
  check (unit_cost is null or unit_cost >= 0);
alter table "inventory_movements" add constraint inventory_movements_after_not_negative
  check (quantity_after >= 0);
-- A stocktake may confirm the count was right (no change); every other movement moves stock.
alter table "inventory_movements" add constraint inventory_movements_moves_something
  check (type = 'stocktake' or quantity_delta <> 0);

create unique index inventory_items_live_sku_key on "inventory_items" (tenant_id, lower(sku))
  where deleted_at is null and sku is not null;
create unique index inventory_categories_name_key on "inventory_categories" (tenant_id, lower(name));

--> statement-breakpoint

create trigger set_updated_at before update on "inventory_categories"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "inventory_items"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "inventory_categories" enable row level security;
alter table "inventory_items" enable row level security;
alter table "inventory_movements" enable row level security;

-- Everyone in the workspace who holds inventory.view can read; the service checks that. Writing
-- is limited to inventory.manage by the database itself as well as the service.
create policy inventory_categories_read on "inventory_categories" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy inventory_categories_insert on "inventory_categories" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'inventory.manage'))
  );

create policy inventory_items_read on "inventory_items" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy inventory_items_insert on "inventory_items" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'inventory.manage'))
  );
create policy inventory_items_update on "inventory_items" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'inventory.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'inventory.manage'))
  );

create policy inventory_movements_read on "inventory_movements" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy inventory_movements_insert on "inventory_movements" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'inventory.manage'))
  );

grant select, insert on "inventory_categories" to authenticated;
grant select, insert, update on "inventory_items" to authenticated;
-- The ledger is append-only: no update or delete for anyone signed in.
grant select, insert on "inventory_movements" to authenticated;

--> statement-breakpoint

-- Existing workspaces get the grants new ones are provisioned with.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('inventory.view'), ('inventory.manage')) as p(permission)
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'inventory.view', null
from public.roles r
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;
