-- Someone whose login has been switched off must stay visible to the people who manage logins,
-- or they could never be switched back on. Everyone else still sees active colleagues only.
create policy users_read_managed on "users" for select to authenticated
  using (
    app.has_permission((select app.active_tenant_id()), 'users.manage')
    and exists (
      select 1 from public.tenant_memberships m
      where m.user_id = "users".id
        and m.tenant_id = (select app.active_tenant_id())
        and m.tenant_id in (select app.tenant_ids())
    )
  );
