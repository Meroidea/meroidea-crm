-- Security review (milestone 14, ADR-059).

-- A person may change only their own name, phone and photo. Their email is their login's and is
-- trusted elsewhere (password links, linking a hire to an existing login), so it stays with the
-- verified auth account and is never writable from a session.
revoke update on "users" from authenticated;
grant update (full_name, phone, avatar_path, updated_at) on "users" to authenticated;

--> statement-breakpoint

-- Workspace settings were written through the privileged connection after a permission check in
-- the application. They now go through row-level security like every other user write: only
-- someone with settings.manage in the active business, and only the columns its own screens
-- change. Who the business is (name, legal name, ABN, contact), its features, status and
-- location stay with the platform console (ADR-029, ADR-033, ADR-047).
grant update (timezone, default_currency, default_country, settings, labels, updated_at)
  on "tenants" to authenticated;
create policy tenant_settings on "tenants" for update to authenticated
  using (
    id = (select app.active_tenant_id())
    and id in (select app.tenant_ids())
    and app.has_permission(id, 'settings.manage')
  )
  with check (
    id = (select app.active_tenant_id())
    and id in (select app.tenant_ids())
    and app.has_permission(id, 'settings.manage')
  );
