-- A platform owner's support seat is now switched off when they leave, instead of deleted.
-- Anything they created or were given while inside still points at the seat, so deleting it
-- failed and left them with full access nobody in the business could remove. A switched-off
-- seat grants nothing: loadTenantContext and app.tenant_ids() admit only active memberships.
alter table "tenant_memberships" drop constraint tenant_memberships_support_is_active;
