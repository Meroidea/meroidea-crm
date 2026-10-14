-- Roles are Admin, Manager and Staff (ADR-048). Existing businesses keep any name they chose:
-- only a role still carrying its old default name and description is renamed. Keys, grants and
-- memberships are untouched.
update "roles"
set name = 'Admin',
  description = 'Runs the business: every feature switched on for it, settings, people, hiring and pay.'
where key = 'owner' and name = 'Owner'
  and description = 'Full access to everything, including billing and settings.';

update "roles"
set description = 'Runs the team day to day: sees everyone’s roster, assigns tasks, approves time and leave. Not pay, hiring or settings.'
where key = 'manager' and name = 'Manager' and description = 'Their team''s records and reports.';

update "roles"
set name = 'Staff',
  description = 'Their own roster, payslips, time, leave, tasks and expenses, and the records they work on.'
where key = 'member' and name = 'Member' and description = 'Their own records.';

--> statement-breakpoint

-- Everyone added to a business joins its team, the one made when the business was created, so
-- a Manager's "team" scope covers the staff they assign work to. People added before this had
-- no team; they join the business's first team now. Support seats stay out of it.
update "tenant_memberships" m
set team_id = (
  select t.id from "teams" t
  where t.tenant_id = m.tenant_id
  order by t.created_at, t.id
  limit 1
)
where m.team_id is null
  and not m.is_support
  and exists (select 1 from "teams" t where t.tenant_id = m.tenant_id);
