-- Purchasing tables from 0017: tenant isolation limited to people who may order, integrity rules
-- and grants for existing workspaces. Applied in the same migrate run as 0017.
-- See docs/database.md §7d and docs/permissions.md.

alter table "suppliers" add constraint suppliers_delivery_days_valid
  check (delivery_days <@ array[0, 1, 2, 3, 4, 5, 6]);
alter table "suppliers" add constraint suppliers_lead_days_range
  check (lead_days between 0 and 60);
alter table "suppliers" add constraint suppliers_cutoff_format
  check (cutoff_time is null or cutoff_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table "supplier_items" add constraint supplier_items_price_not_negative
  check (unit_price >= 0);
alter table "purchase_order_lines" add constraint purchase_order_lines_quantity_positive
  check (quantity > 0);
alter table "purchase_orders" add constraint purchase_orders_sent_has_time
  check (status <> 'sent' or sent_at is not null);

create unique index suppliers_live_name_key on "suppliers" (tenant_id, lower(name))
  where deleted_at is null;

--> statement-breakpoint

create trigger set_updated_at before update on "suppliers"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "supplier_items"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "purchase_orders"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

-- Supplier prices and what a business orders are commercially sensitive, so every operation,
-- reading included, is limited by the database to holders of purchasing.manage.
alter table "suppliers" enable row level security;
alter table "supplier_items" enable row level security;
alter table "purchase_orders" enable row level security;
alter table "purchase_order_lines" enable row level security;

create policy suppliers_manage on "suppliers" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'purchasing.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'purchasing.manage'))
  );
create policy supplier_items_manage on "supplier_items" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'purchasing.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'purchasing.manage'))
  );
create policy purchase_orders_manage on "purchase_orders" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'purchasing.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'purchasing.manage'))
  );
create policy purchase_order_lines_manage on "purchase_order_lines" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'purchasing.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'purchasing.manage'))
  );

grant select, insert, update on "suppliers" to authenticated;
grant select, insert, update on "supplier_items" to authenticated;
grant select, insert, update on "purchase_orders" to authenticated;
-- An order's lines are written once with the order and never changed.
grant select, insert on "purchase_order_lines" to authenticated;

--> statement-breakpoint

-- Existing workspaces get the grant new ones are provisioned with: the owner only.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'purchasing.manage', null
from public.roles r
where r.key = 'owner'
on conflict (role_id, permission) do nothing;
