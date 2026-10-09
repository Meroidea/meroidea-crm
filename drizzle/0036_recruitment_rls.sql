-- Recruitment from 0035: rules, tenant isolation and grants for existing workspaces. Applied in
-- the same migrate run as 0035. See docs/database.md §7j.
-- Applicants are personal data: everything here is readable only with recruitment.manage.
-- Applications from the public page are written by the server (no session), not through RLS.

alter table "job_openings" add constraint job_openings_status_known
  check (status in ('draft', 'open', 'closed'));
alter table "job_openings" add constraint job_openings_type_known
  check (employment_type in ('casual', 'part_time', 'full_time', 'contract'));
alter table "job_applicants" add constraint job_applicants_stage_known
  check (stage in ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected'));
alter table "job_applicants" add constraint job_applicants_source_known
  check (source in ('website', 'manual'));
alter table "job_applicants" add constraint job_applicants_rating_range
  check (rating is null or rating between 1 and 5);

--> statement-breakpoint

create trigger set_updated_at before update on "job_openings"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "job_applicants"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "job_openings" enable row level security;
alter table "job_applicants" enable row level security;
alter table "applicant_notes" enable row level security;

create policy job_openings_all on "job_openings" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'recruitment.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'recruitment.manage'))
  );
create policy job_applicants_all on "job_applicants" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'recruitment.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'recruitment.manage'))
  );
create policy applicant_notes_all on "applicant_notes" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'recruitment.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'recruitment.manage'))
  );

grant select, insert, update on "job_openings" to authenticated;
grant select, insert, update on "job_applicants" to authenticated;
grant select, insert on "applicant_notes" to authenticated;

--> statement-breakpoint

update public.tenants set features = array_append(features, 'recruitment')
where not ('recruitment' = any(features));

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'recruitment.manage', null
from public.roles r
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;
