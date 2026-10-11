-- Feature switches enforced by the database as well as the application (ADR-038).
-- Until now a switched-off feature was hidden only by loadTenantContext dropping its grants.
-- This adds the second layer: a permission for a switched-off feature is not granted inside
-- app.has_permission, app.my_context returns only live grants, and every table that belongs to
-- exactly one feature gets a restrictive policy, so its rows disappear while the feature is off.

-- Mirrors FAMILY_FEATURE in src/lib/features.ts. A DB test fails if the two drift apart.
create or replace function app.permission_feature(perm text) returns text
language sql immutable set search_path = '' as $$
  select case split_part(perm, '.', 1)
    when 'contacts' then 'crm'
    when 'opportunities' then 'crm'
    when 'revenue' then 'crm'
    when 'activities' then 'crm'
    when 'documents' then 'crm'
    when 'partners' then 'crm'
    when 'organizations' then 'crm'
    when 'products' then 'crm'
    when 'reports' then 'crm'
    when 'tasks' then 'tasks'
    when 'rosters' then 'roster'
    when 'timeoff' then 'timeoff'
    when 'timesheets' then 'timesheets'
    when 'employees' then 'staff'
    when 'recruitment' then 'recruitment'
    when 'reviews' then 'reviews'
    when 'tickets' then 'helpdesk'
    when 'projects' then 'projects'
    when 'productivity' then 'productivity'
    when 'inventory' then 'inventory'
    when 'purchasing' then 'purchasing'
    when 'files' then 'files'
    when 'invoices' then 'invoices'
    when 'expenses' then 'expenses'
    when 'payroll' then 'payroll'
    else null
  end;
$$;

-- security definer: a policy on another table must be able to read the tenant's switches
-- whatever the caller's own access to `tenants` is. A null feature means "always available".
create or replace function app.feature_enabled(tenant uuid, feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select feature is null or exists (
    select 1 from public.tenants t where t.id = tenant and feature = any(t.features)
  );
$$;

create or replace function app.has_permission(tenant uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.feature_enabled(tenant, app.permission_feature(perm)) and exists (
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

grant execute on function app.permission_feature(text), app.feature_enabled(uuid, text)
  to authenticated;

--> statement-breakpoint

-- One call now returns everything loadTenantContext needs (it used to take three transactions):
-- the workspace, live grants, the feature switches, the support flag, the clock-in location and
-- the people visible under `team` scope. The return type changes, so the function is replaced.
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
  team_user_ids uuid[]
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

--> statement-breakpoint

-- Tables that belong to exactly one feature. Restrictive policies are ANDed with the existing
-- permissive ones, so they only ever take rows away. Tables shared across features (employees,
-- rosters, payslips, time entries, tasks, activities, projects) are left to has_permission and
-- the application, because hiding them would break a feature that is still switched on.
do $$
declare
  entry record;
begin
  for entry in
    select * from (values
      ('contacts', 'crm'), ('contact_organizations', 'crm'), ('organizations', 'crm'),
      ('opportunities', 'crm'), ('stage_history', 'crm'), ('partners', 'crm'),
      ('pipelines', 'crm'), ('pipeline_stages', 'crm'), ('lost_reasons', 'crm'),
      ('lead_sources', 'crm'),
      ('helpdesk_forms', 'helpdesk'), ('tickets', 'helpdesk'), ('ticket_messages', 'helpdesk'),
      ('review_links', 'reviews'), ('customer_reviews', 'reviews'),
      ('job_openings', 'recruitment'), ('job_applicants', 'recruitment'),
      ('applicant_notes', 'recruitment'),
      ('project_tasks', 'projects'), ('task_time_logs', 'projects'),
      ('inventory_categories', 'inventory'), ('inventory_items', 'inventory'),
      ('inventory_movements', 'inventory'),
      ('suppliers', 'purchasing'), ('supplier_items', 'purchasing'),
      ('purchase_orders', 'purchasing'), ('purchase_order_lines', 'purchasing'),
      ('library_documents', 'files'), ('library_document_versions', 'files'),
      ('expense_claims', 'expenses'),
      ('invoices', 'invoices'), ('invoice_lines', 'invoices'),
      ('leave_types', 'timeoff'), ('leave_requests', 'timeoff')
    ) as t(table_name, feature)
  loop
    -- The tenant is the active one (every permissive policy requires that), so the check is
    -- written against it and evaluated once per statement rather than once per row.
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      entry.table_name, entry.feature, entry.feature
    );
  end loop;
end;
$$;
