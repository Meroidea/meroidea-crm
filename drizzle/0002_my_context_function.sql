-- Resolves the signed-in person's workspace, role and grants in one call.
-- security definer so it works before any tenant context exists, without the admin client.
create or replace function app.my_context(preferred uuid default null)
returns table (
  tenant_id uuid,
  membership_id uuid,
  role_key text,
  role_name text,
  tenant_name text,
  tenant_slug text,
  tenant_timezone text,
  tenant_currency char(3),
  tenant_country char(2),
  tenant_primary_color text,
  tenant_status text,
  tenant_labels jsonb,
  tenant_settings jsonb,
  grants jsonb
)
language sql stable security definer set search_path = '' as $$
  select
    t.id,
    m.id,
    r.key,
    r.name,
    t.name,
    t.slug,
    t.timezone,
    t.default_currency,
    t.default_country,
    t.primary_color,
    t.status::text,
    t.labels,
    t.settings,
    coalesce(
      (select jsonb_object_agg(rp.permission, coalesce(rp.scope::text, 'true'))
       from public.role_permissions rp
       where rp.role_id = r.id and rp.tenant_id = t.id),
      '{}'::jsonb
    )
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.id = m.role_id and r.tenant_id = m.tenant_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and (preferred is null or t.id = preferred)
  order by (t.id is not distinct from preferred) desc, m.created_at
  limit 1;
$$;

grant execute on function app.my_context(uuid) to authenticated;
