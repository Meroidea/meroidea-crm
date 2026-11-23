-- AI assistant (ADR-073). No tables: the assistant keeps no conversations and stores nothing
-- the model says. Its only footprint is the feature switch and the `ai.use` permission, so the
-- permission counts as not granted while the platform owner has the feature switched off.

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
    when 'social' then 'inbox'
    when 'kb' then 'knowledge_base'
    when 'ai' then 'ai_assistant'
    else null
  end;
$$;
--> statement-breakpoint

-- Every Admin and Manager may use the assistant once the feature is on, as new businesses'
-- roles do. Each tool still needs the permission of what it reads or drafts.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'ai.use', null
from public.roles r where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;
