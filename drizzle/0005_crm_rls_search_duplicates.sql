-- CRM core: tenant isolation, grants, fuzzy search and duplicate lookup for the tables in 0004.
-- Applied in the same `drizzle-kit migrate` run as 0004, so the tables never exist without RLS.
-- See docs/database.md §4, §10, §11.

create extension if not exists pg_trgm with schema extensions;

--> statement-breakpoint

create trigger set_updated_at before update on "lead_sources"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "organizations"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "contacts"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

-- Name search that tolerates typos and partial names ("Jon Smth").
create index contacts_full_name_trgm_idx on "contacts"
  using gin ("full_name" extensions.gin_trgm_ops) where "deleted_at" is null;
create index organizations_name_trgm_idx on "organizations"
  using gin ("name" extensions.gin_trgm_ops) where "deleted_at" is null;

--> statement-breakpoint

alter table "lead_sources" enable row level security;
alter table "organizations" enable row level security;
alter table "contacts" enable row level security;
alter table "contact_organizations" enable row level security;

create policy tenant_isolation on "lead_sources" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

create policy tenant_isolation on "organizations" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

create policy tenant_isolation on "contacts" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

create policy tenant_isolation on "contact_organizations" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));

grant select, insert, update, delete on "lead_sources" to authenticated;
-- Business records are soft-deleted by the service; users never hard-delete them.
grant select, insert, update on "organizations" to authenticated;
grant select, insert, update on "contacts" to authenticated;
grant select, insert, delete on "contact_organizations" to authenticated;

--> statement-breakpoint

-- Duplicate lookup across the whole workspace, not just the caller's scope: a consultant must
-- learn "already owned by Sarah" for a record they cannot open (docs/database.md §10).
-- security definer bypasses scope, so it returns only what the warning needs; the service
-- decides whether the caller may also see the record itself.
create or replace function app.find_contact_duplicates(
  p_email_normalized text,
  p_phone_e164 text,
  p_full_name text,
  p_date_of_birth date,
  p_exclude_id uuid default null
)
returns table (
  contact_id uuid,
  owner_user_id uuid,
  owner_name text,
  match_kind text
)
language sql stable security definer set search_path = '' as $$
  with tenant as (
    select app.active_tenant_id() as id
    where app.active_tenant_id() in (select app.tenant_ids())
  )
  select c.id,
         c.owner_user_id,
         u.full_name,
         case
           when p_email_normalized is not null and c.email_normalized = p_email_normalized then 'email'
           when p_phone_e164 is not null and c.phone_e164 = p_phone_e164 then 'phone'
           else 'name_dob'
         end
  from public.contacts c
  join tenant on c.tenant_id = tenant.id
  left join public.users u on u.id = c.owner_user_id
  where c.deleted_at is null
    and (p_exclude_id is null or c.id <> p_exclude_id)
    and (
      (p_email_normalized is not null and c.email_normalized = p_email_normalized)
      or (p_phone_e164 is not null and c.phone_e164 = p_phone_e164)
      or (
        p_date_of_birth is not null and c.date_of_birth = p_date_of_birth
        and p_full_name is not null
        and extensions.similarity(c.full_name, p_full_name) > 0.6
      )
    )
  order by 4, c.created_at
  limit 5;
$$;

revoke all on function app.find_contact_duplicates(text, text, text, date, uuid) from public;
grant execute on function app.find_contact_duplicates(text, text, text, date, uuid) to authenticated;

--> statement-breakpoint

-- Existing workspaces get the same neutral starting sources new ones are provisioned with.
insert into public.lead_sources (tenant_id, name, type, position)
select t.id, s.name, s.type::public.lead_source_type, s.position
from public.tenants t
cross join (values
  ('Manual entry', 'manual', 0),
  ('Website', 'web_form', 1),
  ('Referral', 'referral', 2),
  ('Walk-in', 'walk_in', 3),
  ('Partner', 'partner', 4),
  ('Social media', 'social', 5),
  ('Import', 'import', 6)
) as s(name, type, position)
on conflict (tenant_id, name) do nothing;
