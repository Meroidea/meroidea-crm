-- Tenant isolation, auth wiring and audit immutability.
-- See docs/database.md §11 and ADR-006/007.

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- Profiles are 1:1 with auth.users and disappear with them.
alter table "users"
  add constraint users_auth_users_fk
  foreign key ("id") references auth.users("id") on delete cascade;

-- Keep updated_at honest without trusting the application.
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on "tenants"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "users"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "teams"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "roles"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "tenant_memberships"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "tenant_subscriptions"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

-- Helpers used by every policy. security definer so they can read memberships
-- regardless of the caller's own row-level access.
create or replace function app.user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select auth.uid();
$$;

create or replace function app.tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id
  from public.tenant_memberships m
  where m.user_id = auth.uid()
    and m.status = 'active';
$$;

create or replace function app.active_tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

create or replace function app.has_permission(tenant uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tenant_memberships m
    join public.role_permissions rp
      on rp.tenant_id = m.tenant_id and rp.role_id = m.role_id
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.tenant_id = tenant
      and rp.permission = perm
  );
$$;

grant execute on function app.user_id(), app.tenant_ids(), app.active_tenant_id(),
  app.has_permission(uuid, text) to authenticated;

--> statement-breakpoint

-- A profile row appears the moment an auth user is created, so sign-up never races it.
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

--> statement-breakpoint

-- RLS on every table, with no policies for anon (ADR-007).
alter table "tenants" enable row level security;
alter table "users" enable row level security;
alter table "teams" enable row level security;
alter table "roles" enable row level security;
alter table "role_permissions" enable row level security;
alter table "tenant_memberships" enable row level security;
alter table "tenant_subscriptions" enable row level security;
alter table "audit_logs" enable row level security;

-- Tenant-owned tables: reachable only inside withRls(), and only for a tenant the
-- caller is an active member of.
create policy tenant_isolation on "teams" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

create policy tenant_isolation on "roles" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

create policy tenant_isolation on "role_permissions" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

create policy tenant_isolation on "tenant_memberships" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

create policy tenant_isolation on "tenant_subscriptions" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

-- Audit rows are readable within the tenant and written by the service layer only.
create policy tenant_isolation on "audit_logs" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

create policy tenant_isolation on "tenants" for select to authenticated
  using (id = (select app.active_tenant_id()) and id in (select app.tenant_ids()));

-- A person can read colleagues who share an active tenant, and edit only themselves.
create policy users_read_colleagues on "users" for select to authenticated
  using (
    id = (select app.user_id())
    or exists (
      select 1 from public.tenant_memberships m
      where m.user_id = "users".id
        and m.status = 'active'
        and m.tenant_id in (select app.tenant_ids())
    )
  );

create policy users_update_self on "users" for update to authenticated
  using (id = (select app.user_id()))
  with check (id = (select app.user_id()));

--> statement-breakpoint

-- Append-only audit trail.
revoke update, delete on "audit_logs" from authenticated;
