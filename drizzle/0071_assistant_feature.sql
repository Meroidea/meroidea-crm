-- AI assistant (ADR-063). A new feature, off for every business until the platform owner
-- switches it on, with one permission, assistant.use. The permission opens the assistant only:
-- its tools read through the existing report, task and opportunity queries, under RLS, so what
-- it can tell a person is still decided by their reports/tasks/opportunities/revenue grants.
-- The assistant owns no table, so there is no feature_switch policy to add.
--
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
    when 'concerns' then 'concerns'
    when 'training' then 'training'
    when 'books' then 'books'
    when 'assistant' then 'assistant'
    else null
  end;
$$;

--> statement-breakpoint

-- Existing businesses' Admin role gets the grant a new business's Admin gets. Manager and Staff
-- get it only in new businesses (DEFAULT_ROLES): an existing business may have narrowed those
-- roles, and its admin decides whether to add it once the feature is on.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'assistant.use', null
from public.roles r
where r.key = 'owner'
on conflict (role_id, permission) do nothing;
