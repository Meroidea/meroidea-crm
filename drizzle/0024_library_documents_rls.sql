-- Document library from 0023: storage bucket, tenant isolation, who may write, and grants for
-- existing workspaces. Applied in the same migrate run as 0023.
-- See docs/database.md §7f and docs/permissions.md.

-- Private bucket: no storage policies are created, so only the server (service role) can read
-- or write objects, and it does so only after checking the person's permission.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

alter table "library_documents" add constraint library_documents_size_positive
  check (size_bytes > 0);
alter table "library_documents" add constraint library_documents_extension_known
  check (extension in ('docx', 'xlsx', 'pptx', 'pdf'));

--> statement-breakpoint

create trigger set_updated_at before update on "library_documents"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

alter table "library_documents" enable row level security;
alter table "library_document_versions" enable row level security;

create policy library_documents_read on "library_documents" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy library_documents_insert on "library_documents" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.manage'))
  );
create policy library_documents_update on "library_documents" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.manage'))
  );

create policy library_document_versions_read on "library_document_versions" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()));
create policy library_document_versions_insert on "library_document_versions" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'files.manage'))
  );

grant select, insert, update on "library_documents" to authenticated;
-- Versions are only ever added. Saves coming back from the editor are written by the server.
grant select, insert on "library_document_versions" to authenticated;

--> statement-breakpoint

-- Existing businesses get the feature and the grants new ones are provisioned with.
update public.tenants set features = array_append(features, 'files')
where not ('files' = any(features));

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('files.view'), ('files.edit'), ('files.manage')) as p(permission)
where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('files.view'), ('files.edit')) as p(permission)
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;
