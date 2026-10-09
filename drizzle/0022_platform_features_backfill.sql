-- Feature switches from 0021 (ADR-029). Businesses that already exist keep everything they have
-- today; a new business gets only what the platform owner switches on when onboarding it.
-- Applied in the same migrate run as 0021.

update public.tenants
set features = array['crm', 'tasks', 'roster', 'staff', 'inventory', 'purchasing', 'invoices', 'payroll']
where features = '{}';

-- Only one support seat per person per business, and it is always an active one.
alter table "tenant_memberships" add constraint tenant_memberships_support_is_active
  check (not is_support or status = 'active');
