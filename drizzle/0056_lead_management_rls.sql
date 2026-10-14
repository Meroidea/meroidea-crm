-- Lead management (docs/leads.md, ADR-051): rules, row-level security, grants, the CRM feature
-- switch, and starting lists for businesses that already exist. See docs/database.md §4a.

alter table "contacts" add constraint contacts_sub_source_needs_source
  check (sub_source_id is null or source_id is not null);
alter table "contacts" add constraint contacts_lead_reason_note_length
  check (lead_reason_note is null or char_length(lead_reason_note) <= 1000);
alter table "contacts" add constraint contacts_handover_summary_length
  check (handover_summary is null or char_length(handover_summary) <= 2000);
alter table "lead_sub_sources" add constraint lead_sub_sources_name_length
  check (char_length(name) between 1 and 80);
alter table "lead_statuses" add constraint lead_statuses_name_length
  check (char_length(name) between 1 and 60);
alter table "lead_reasons" add constraint lead_reasons_name_length
  check (char_length(name) between 1 and 80);
-- The status the system moves leads into, one per kind and workflow.
create unique index lead_statuses_one_system_key on "lead_statuses"
  (tenant_id, kind, lead_type) nulls not distinct where is_system;
alter table "import_batches" add constraint import_batches_strategy_known
  check (duplicate_strategy in ('skip', 'merge', 'create'));
alter table "custom_field_definitions" add constraint custom_field_definitions_key_format
  check (key ~ '^[a-z][a-z0-9_]{0,39}$');
alter table "custom_field_definitions" add constraint custom_field_definitions_label_length
  check (char_length(label) between 1 and 60);
alter table "pipeline_stages" add constraint pipeline_stages_on_enter_known
  check (on_enter in ('notify', 'reassign', 'task'));
alter table "pipeline_stages" add constraint pipeline_stages_one_owner
  check (owner_user_id is null or owner_team_id is null);
alter table "opportunities" add constraint opportunities_probability_range
  check (probability is null or probability between 0 and 100);
alter table "opportunities" add constraint opportunities_next_step_length
  check (next_step is null or char_length(next_step) <= 300);
alter table "stage_approvals" add constraint stage_approvals_status_known
  check (status in ('pending', 'approved', 'declined', 'withdrawn'));
create unique index stage_approvals_one_pending_key on "stage_approvals" (tenant_id, opportunity_id)
  where status = 'pending';
alter table "routing_rules" add constraint routing_rules_stage_known
  check (stage in ('intake', 'handover'));
alter table "routing_rules" add constraint routing_rules_method_known
  check (method in ('round_robin', 'least_loaded'));
alter table "sequence_enrollments" add constraint sequence_enrollments_status_known
  check (status in ('active', 'completed', 'stopped'));
create unique index sequence_enrollments_one_active_key on "sequence_enrollments"
  (tenant_id, sequence_id, contact_id) where status = 'active';
alter table "email_templates" add constraint email_templates_lengths
  check (char_length(name) between 1 and 80 and char_length(subject) between 1 and 200
         and char_length(body) between 1 and 20000);
alter table "web_forms" add constraint web_forms_name_length
  check (char_length(name) between 1 and 80);
alter table "lead_intake_events" add constraint lead_intake_events_status_known
  check (status in ('received', 'created', 'matched', 'failed'));

--> statement-breakpoint

do $$
declare t text;
begin
  foreach t in array array['lead_sub_sources', 'lead_statuses', 'lead_reasons',
    'custom_field_definitions', 'routing_rules', 'email_templates', 'sequences', 'web_forms']
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t);
  end loop;
end;
$$;

--> statement-breakpoint

-- Tenant isolation on every new table; the services check permissions and record scope.
do $$
declare t text;
begin
  foreach t in array array['lead_sub_sources', 'lead_statuses', 'lead_reasons', 'import_batches',
    'custom_field_definitions', 'contact_links', 'opportunity_contacts', 'stage_approvals',
    'routing_rules', 'email_templates', 'sequences', 'sequence_enrollments', 'web_forms',
    'lead_intake_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to authenticated
         using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))
         with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()))',
      t);
    -- All of them belong to the CRM feature (ADR-038).
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'crm', 'crm');
  end loop;
end;
$$;

--> statement-breakpoint

-- Notifications are personal: you read and mark only your own. Anyone in the business may
-- notify a colleague (assigning them a lead does), but never change or remove a notice.
alter table "notifications" enable row level security;
create policy notifications_read on "notifications" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select app.user_id())
  );
create policy notifications_insert on "notifications" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and read_at is null and emailed_at is null
  );
create policy notifications_mark_read on "notifications" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select app.user_id())
  )
  with check (user_id = (select app.user_id()));

--> statement-breakpoint

-- Configuration lists are switched off, never deleted, so history keeps its labels.
grant select, insert, update on "lead_sub_sources" to authenticated;
grant select, insert, update on "lead_statuses" to authenticated;
grant select, insert, update on "lead_reasons" to authenticated;
grant select, insert, update on "custom_field_definitions" to authenticated;
grant select, insert, update on "import_batches" to authenticated;
grant select, insert, delete on "contact_links" to authenticated;
grant select, insert, update, delete on "opportunity_contacts" to authenticated;
grant select, insert, update on "stage_approvals" to authenticated;
grant select, insert, update, delete on "routing_rules" to authenticated;
grant select, insert, update, delete on "email_templates" to authenticated;
grant select, insert, update on "sequences" to authenticated;
grant select, insert, update on "sequence_enrollments" to authenticated;
grant select, insert, update on "web_forms" to authenticated;
-- Submissions are written by the public form endpoint's privileged connection only.
grant select on "lead_intake_events" to authenticated;
grant select, insert on "notifications" to authenticated;
grant update (read_at) on "notifications" to authenticated;

--> statement-breakpoint

-- Starting lists for businesses that already exist; new businesses get the same from
-- provisionTenant() (src/lib/tenant/defaults.ts — keep the two in step).
insert into public.lead_statuses (tenant_id, name, kind, lead_type, requires_reason, is_system, color, position)
select t.id, s.name, s.kind::public.lead_status_kind, s.lead_type::public.lead_type, s.requires_reason,
  s.is_system, s.color, s.position
from public.tenants t
cross join (values
  ('New', 'new', null, false, true, 'chart-2', 0),
  ('Working', 'working', 'b2b', false, false, 'chart-3', 1),
  ('Contacted', 'working', null, false, false, 'chart-3', 2),
  ('Engaged', 'working', null, false, false, 'info', 3),
  ('Meeting agreed', 'working', 'b2b', false, false, 'chart-4', 4),
  ('Consultation booked', 'working', 'b2c', false, false, 'chart-4', 5),
  ('Pending acceptance', 'pending_acceptance', null, false, true, 'chart-5', 6),
  ('Returned', 'returned', null, false, true, 'chart-1', 7),
  ('Accepted', 'converted', 'b2b', false, true, 'positive', 8),
  ('Qualified', 'converted', 'b2c', false, true, 'positive', 9),
  ('Not interested', 'closed', null, true, false, 'primary', 10),
  ('Unresponsive', 'closed', null, false, false, 'primary', 11),
  ('Disqualified', 'closed', null, true, false, 'destructive', 12)
) as s(name, kind, lead_type, requires_reason, is_system, color, position);

insert into public.lead_reasons (tenant_id, kind, name, position)
select t.id, r.kind::public.lead_reason_kind, r.name, r.position
from public.tenants t
cross join (values
  ('disqualify', 'Bad or incomplete data', 0),
  ('disqualify', 'Not a fit', 1),
  ('disqualify', 'No budget', 2),
  ('disqualify', 'No longer interested', 3),
  ('disqualify', 'Duplicate', 4),
  ('disqualify', 'Other', 5),
  ('reject', 'Not a decision maker', 0),
  ('reject', 'No budget', 1),
  ('reject', 'Wrong fit', 2),
  ('reject', 'Insufficient information', 3),
  ('reject', 'Other', 4)
) as r(kind, name, position);

-- Sub-sources under the sources a business already has, and the two sources the brief adds.
insert into public.lead_sources (tenant_id, name, type, position)
select t.id, s.name, s.type::public.lead_source_type, 100 + s.position
from public.tenants t
cross join (values ('Marketing', 'other', 0), ('Data upload', 'import', 1), ('Other', 'other', 2))
  as s(name, type, position)
on conflict (tenant_id, name) do nothing;

insert into public.lead_sub_sources (tenant_id, source_id, name, position)
select ls.tenant_id, ls.id, sub.name, sub.position
from public.lead_sources ls
join (values
  ('Marketing', 'Marketing event – workshop', 0),
  ('Marketing', 'Marketing event – expo or seminar', 1),
  ('Marketing', 'Digital campaign – Meta ads', 2),
  ('Marketing', 'Digital campaign – Google ads', 3),
  ('Marketing', 'Email campaign', 4),
  ('Data upload', 'LinkedIn', 0),
  ('Data upload', 'Instagram', 1),
  ('Data upload', 'Purchased or partner list', 2),
  ('Data upload', 'Other import', 3),
  ('Website', 'Contact us form', 0),
  ('Website', 'Feedback form', 1),
  ('Website', 'Enquiry or landing page form', 2),
  ('Website', 'Live chat', 3),
  ('Referral', 'Existing customer', 0),
  ('Referral', 'Partner or agent', 1),
  ('Referral', 'Staff referral', 2),
  ('Walk-in', 'Walk-in', 0),
  ('Walk-in', 'Inbound call', 1)
) as sub(source_name, name, position) on sub.source_name = ls.name
on conflict (tenant_id, source_id, name) do nothing;

--> statement-breakpoint

-- New permissions for existing roles, as a new business gets them (src/lib/permissions/catalog.ts).
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('opportunities.approve'), ('contacts.anonymize'), ('contacts.merge')) as p(permission)
where r.key = 'owner'
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('opportunities.approve'), ('contacts.merge')) as p(permission)
where r.key = 'manager'
on conflict (role_id, permission) do nothing;

--> statement-breakpoint

-- B2B duplicates: the same person at the same company, by name (docs/leads.md §3.4). Like
-- app.find_contact_duplicates, it searches the whole business but returns only what the warning
-- needs; the service decides whether the caller may open the match.
create function app.find_company_contact_duplicates(
  p_company_name text,
  p_full_name text,
  p_exclude_id uuid default null
)
returns table (contact_id uuid, owner_user_id uuid, owner_name text, match_kind text)
language sql stable security definer set search_path = '' as $$
  with tenant as (
    select app.active_tenant_id() as id
    where app.active_tenant_id() in (select app.tenant_ids())
  )
  select c.id, c.owner_user_id, u.full_name, 'company_name'
  from public.contacts c
  join tenant on c.tenant_id = tenant.id
  left join public.users u on u.id = c.owner_user_id
  where c.deleted_at is null
    and (p_exclude_id is null or c.id <> p_exclude_id)
    and p_company_name is not null and p_full_name is not null
    and lower(trim(c.company_name)) = lower(trim(p_company_name))
    and extensions.similarity(c.full_name, p_full_name) > 0.6
  order by c.created_at
  limit 5;
$$;
revoke all on function app.find_company_contact_duplicates(text, text, uuid) from public;
grant execute on function app.find_company_contact_duplicates(text, text, uuid) to authenticated;
