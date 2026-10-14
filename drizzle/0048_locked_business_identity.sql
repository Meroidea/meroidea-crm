-- The business's identity moves out of the settings its admin can edit and into columns only
-- the platform console writes (ADR-047): its legal name and business number (ABN). Values a
-- business already saved are carried over, then removed from the editable settings so there
-- is one source of truth.
update "tenants"
set
  legal_name = nullif(trim(settings #>> '{business,legalName}'), ''),
  business_number = nullif(trim(settings #>> '{business,businessNumber}'), ''),
  settings = jsonb_set(settings, '{business}', (settings -> 'business') - 'legalName' - 'businessNumber')
where jsonb_typeof(settings -> 'business') = 'object';

--> statement-breakpoint

-- app.my_context also returns the legal name and business number, which payslips print. The
-- return type changes, so the function is replaced (body otherwise as in 0043).
drop function app.my_context(uuid);

create function app.my_context(preferred uuid default null)
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
  grants jsonb,
  tenant_features text[],
  is_support boolean,
  location_latitude numeric,
  location_longitude numeric,
  clock_radius_metres integer,
  team_user_ids uuid[],
  tenant_legal_name text,
  tenant_business_number text
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
       where rp.role_id = r.id and rp.tenant_id = t.id
         and (app.permission_feature(rp.permission) is null
              or app.permission_feature(rp.permission) = any(t.features))),
      '{}'::jsonb
    ),
    t.features,
    m.is_support,
    t.location_latitude,
    t.location_longitude,
    t.clock_radius_metres,
    array(
      select distinct colleague.user_id
      from public.tenant_memberships colleague
      where colleague.tenant_id = t.id
        and colleague.status = 'active'
        and (
          colleague.user_id = m.user_id
          or (m.team_id is not null and colleague.team_id = m.team_id)
          or colleague.team_id in (
            select team.id from public.teams team
            where team.tenant_id = t.id and team.manager_user_id = m.user_id
          )
        )
    ),
    t.legal_name,
    t.business_number
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
