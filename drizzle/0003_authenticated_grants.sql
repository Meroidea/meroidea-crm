-- RLS decides which rows; these grants decide which verbs. Both are required — a policy alone
-- leaves `authenticated` with no privileges at all, because auto_expose_new_tables is off (ADR-007).

-- Workspace settings are changed by the settings service, not by user SQL.
grant select on "tenants" to authenticated;
grant select on "tenant_subscriptions" to authenticated;

-- A person reads colleagues and edits only their own profile (enforced by policy).
grant select, update on "users" to authenticated;

grant select, insert, update, delete on "teams" to authenticated;
grant select, insert, update, delete on "roles" to authenticated;
grant select, insert, update, delete on "role_permissions" to authenticated;
grant select, insert, update, delete on "tenant_memberships" to authenticated;

-- Append-only: no update, no delete, ever.
grant select, insert on "audit_logs" to authenticated;
