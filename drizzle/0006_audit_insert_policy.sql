-- audit() runs inside withRls(), as the signed-in user. 0001 gave audit_logs a select policy
-- only, so every audited write was rejected. Members may append rows for their active tenant,
-- attributed to themselves; update and delete stay revoked (append-only).
create policy audit_append on "audit_logs" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id())
    and tenant_id in (select app.tenant_ids())
    and actor_user_id = (select app.user_id())
    and actor_type = 'user'
  );
