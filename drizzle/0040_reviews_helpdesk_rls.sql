-- Customer reviews and the helpdesk from 0039: rules, tenant isolation and grants for existing
-- workspaces. Applied in the same migrate run as 0039. See docs/database.md §7l and §7m.
-- Reviews and tickets arriving from public pages are written by the server (no session).

alter table "customer_reviews" add constraint customer_reviews_rating_range
  check (rating between 1 and 5);
alter table "customer_reviews" add constraint customer_reviews_status_known
  check (status in ('new', 'read', 'resolved'));
alter table "tickets" add constraint tickets_priority_known
  check (priority in ('low', 'normal', 'high', 'urgent'));
alter table "tickets" add constraint tickets_status_known
  check (status in ('open', 'pending', 'on_hold', 'solved', 'closed'));
alter table "tickets" add constraint tickets_source_known
  check (source in ('web_form', 'manual'));

--> statement-breakpoint

create trigger set_updated_at before update on "review_links"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "customer_reviews"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "helpdesk_forms"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "tickets"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "review_links" enable row level security;
alter table "customer_reviews" enable row level security;
alter table "helpdesk_forms" enable row level security;
alter table "tickets" enable row level security;
alter table "ticket_messages" enable row level security;

create policy review_links_read on "review_links" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'reviews.view'))
  );
create policy review_links_insert on "review_links" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'reviews.manage'))
  );
create policy review_links_update on "review_links" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'reviews.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'reviews.manage'))
  );

create policy customer_reviews_read on "customer_reviews" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'reviews.view'))
  );
create policy customer_reviews_update on "customer_reviews" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'reviews.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'reviews.manage'))
  );

create policy helpdesk_forms_read on "helpdesk_forms" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))
  );
create policy helpdesk_forms_insert on "helpdesk_forms" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.manage'))
  );
create policy helpdesk_forms_update on "helpdesk_forms" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.manage'))
  );

create policy tickets_all on "tickets" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))
  );
create policy ticket_messages_read on "ticket_messages" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))
  );
-- Staff write as themselves; nobody can put words in a customer's or colleague's mouth.
create policy ticket_messages_insert on "ticket_messages" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))
    and author_user_id = (select app.user_id())
  );

grant select, insert, update on "review_links" to authenticated;
grant select, update on "customer_reviews" to authenticated;
grant select, insert, update on "helpdesk_forms" to authenticated;
grant select, insert, update on "tickets" to authenticated;
grant select, insert on "ticket_messages" to authenticated;

--> statement-breakpoint

update public.tenants set features = features || array['reviews', 'helpdesk']
where not ('reviews' = any(features));

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('reviews.view'), ('reviews.manage'), ('tickets.work'), ('tickets.manage')) as p(permission)
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'tickets.work', null
from public.roles r
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;
