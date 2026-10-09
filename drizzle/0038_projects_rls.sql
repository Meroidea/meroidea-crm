-- Projects from 0037: rules, tenant isolation, who may change what, and grants for existing
-- workspaces. Applied in the same migrate run as 0037. See docs/database.md §7k.

alter table "projects" add constraint projects_status_known
  check (status in ('active', 'on_hold', 'completed'));
alter table "projects" add constraint projects_dates_ordered
  check (starts_on is null or due_on is null or due_on >= starts_on);
alter table "project_tasks" add constraint project_tasks_status_known
  check (status in ('todo', 'in_progress', 'review', 'done'));
alter table "project_tasks" add constraint project_tasks_priority_known
  check (priority in ('low', 'normal', 'high'));
alter table "project_tasks" add constraint project_tasks_estimate_sane
  check (estimate_minutes is null or estimate_minutes between 1 and 100000);
alter table "task_time_logs" add constraint task_time_logs_end_after_start
  check (ended_at is null or ended_at >= started_at);
alter table "task_time_logs" add constraint task_time_logs_minutes_sane
  check (minutes is null or minutes between 1 and 1440);
-- A stopped timer always has its minutes.
alter table "task_time_logs" add constraint task_time_logs_stopped_has_minutes
  check (ended_at is null or minutes is not null);

--> statement-breakpoint

create trigger set_updated_at before update on "projects"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "project_tasks"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "projects" enable row level security;
alter table "project_tasks" enable row level security;
alter table "task_time_logs" enable row level security;

create policy projects_read on "projects" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'projects.view'))
  );
create policy projects_insert on "projects" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'projects.manage'))
  );
create policy projects_update on "projects" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'projects.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'projects.manage'))
  );

create policy project_tasks_read on "project_tasks" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'projects.view'))
  );
create policy project_tasks_insert on "project_tasks" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'projects.manage'))
  );
-- People move their own tasks along; everything else needs projects.manage.
create policy project_tasks_update on "project_tasks" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      assignee_user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'projects.manage'))
    )
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      assignee_user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'projects.manage'))
    )
  );

-- A person's logged time is theirs; managers and whoever reads productivity reports see all.
create policy task_time_logs_read on "task_time_logs" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'projects.manage'))
      or (select app.has_permission((select app.active_tenant_id()), 'productivity.view'))
    )
  );
create policy task_time_logs_insert on "task_time_logs" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select app.user_id())
    and (select app.has_permission((select app.active_tenant_id()), 'projects.view'))
  );
create policy task_time_logs_update on "task_time_logs" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select app.user_id())
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select app.user_id())
  );
create policy task_time_logs_delete on "task_time_logs" for delete to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'projects.manage'))
    )
  );

grant select, insert, update on "projects" to authenticated;
grant select, insert, update on "project_tasks" to authenticated;
grant select, insert, update, delete on "task_time_logs" to authenticated;

--> statement-breakpoint

update public.tenants set features = features || array['projects', 'productivity']
where not ('projects' = any(features));

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('projects.view'), ('projects.manage'), ('productivity.view')) as p(permission)
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'projects.view', null
from public.roles r
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;
