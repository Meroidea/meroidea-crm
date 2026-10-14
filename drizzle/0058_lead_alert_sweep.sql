-- Scheduled alerts for one business (docs/leads.md §5): leads waiting for an owner, a first
-- contact or an acceptance past the business's SLA, leads and opportunities gone quiet, and
-- tasks just gone overdue. Each alert has a dedupe key, so running the sweep again (every few
-- minutes while people use the app, and daily from the scheduler) never repeats one.
--
-- Called only by the server's privileged connection (the scheduler, or the app on behalf of a
-- signed-in member of that business); nobody else is granted it.

create function app.sweep_lead_alerts(p_tenant uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sla jsonb;
  tz text;
  unassigned_hours int;
  first_contact_hours int;
  stale_days int;
  today text;
  added int := 0;
  n int;
begin
  select coalesce(t.settings -> 'crm' -> 'sla', '{}'::jsonb), t.timezone
  into sla, tz
  from public.tenants t
  where t.id = p_tenant
    and t.status in ('trialing', 'active', 'past_due')
    and 'crm' = any(t.features);
  if not found then
    return 0;
  end if;

  -- The same defaults and bounds as the settings form (src/modules/leads/settings.ts).
  unassigned_hours := case when jsonb_typeof(sla -> 'unassignedHours') = 'number'
    then least(greatest((sla ->> 'unassignedHours')::numeric::int, 1), 720) else 24 end;
  first_contact_hours := case when jsonb_typeof(sla -> 'firstContactHours') = 'number'
    then least(greatest((sla ->> 'firstContactHours')::numeric::int, 1), 720) else 24 end;
  stale_days := case when jsonb_typeof(sla -> 'staleLeadDays') = 'number'
    then least(greatest((sla ->> 'staleLeadDays')::numeric::int, 1), 365) else 7 end;
  today := to_char(now() at time zone tz, 'YYYY-MM-DD');

  -- Who can hand out leads: the people the queue and escalations go to.
  create temporary table if not exists sweep_assigners (user_id uuid) on commit drop;
  truncate sweep_assigners;
  insert into sweep_assigners
  select distinct m.user_id
  from public.tenant_memberships m
  join public.role_permissions rp on rp.tenant_id = m.tenant_id and rp.role_id = m.role_id
  where m.tenant_id = p_tenant and m.status = 'active' and not m.is_support
    and rp.permission = 'contacts.assign' and (rp.scope is null or rp.scope = 'all');

  -- 1. Leads nobody owns past the SLA: one summary a day to each person who can assign them.
  insert into public.notifications (tenant_id, user_id, type, title, url, dedupe_key, email_wanted)
  select p_tenant, a.user_id, 'lead_unassigned',
    w.total || case when w.total = 1 then ' lead has' else ' leads have' end
      || ' waited more than ' || unassigned_hours || ' hours for an owner',
    '/leads?view=queue', 'unassigned:' || today, true
  from (
    select count(*)::int as total
    from public.contacts c
    join public.lead_statuses s on s.tenant_id = c.tenant_id and s.id = c.lead_status_id
    where c.tenant_id = p_tenant and c.deleted_at is null and c.anonymized_at is null
      and c.owner_user_id is null and s.kind in ('new', 'working', 'returned')
      and c.created_at < now() - make_interval(hours => unassigned_hours)
  ) w
  cross join sweep_assigners a
  where w.total > 0
  on conflict do nothing;
  get diagnostics n = row_count;
  added := added + n;

  -- 2. No first call or email within the SLA of the lead reaching its owner.
  insert into public.notifications (tenant_id, user_id, type, title, url, dedupe_key, email_wanted)
  select p_tenant, c.owner_user_id, 'first_contact_overdue',
    'First contact overdue: ' || c.full_name, '/contacts/' || c.id,
    'first-contact:' || c.id, true
  from public.contacts c
  join public.lead_statuses s on s.tenant_id = c.tenant_id and s.id = c.lead_status_id
  join public.tenant_memberships m
    on m.tenant_id = c.tenant_id and m.user_id = c.owner_user_id and m.status = 'active'
  where c.tenant_id = p_tenant and c.deleted_at is null and c.anonymized_at is null
    and s.kind in ('new', 'working', 'returned') and c.first_contacted_at is null
    and coalesce(c.assigned_at, c.created_at) < now() - make_interval(hours => first_contact_hours)
  on conflict do nothing;
  get diagnostics n = row_count;
  added := added + n;

  -- 3. A handover not accepted or returned by its due date (business days, set at handover):
  --    the recipient is reminded, and the SDR and the people who assign leads are told.
  insert into public.notifications (tenant_id, user_id, type, title, url, dedupe_key, email_wanted)
  select p_tenant, r.user_id, 'acceptance_overdue',
    'Waiting to be accepted: ' || c.full_name, '/contacts/' || c.id,
    'acceptance:' || c.id || ':' || extract(epoch from c.handover_at)::bigint || ':' || r.role,
    true
  from public.contacts c
  join public.lead_statuses s on s.tenant_id = c.tenant_id and s.id = c.lead_status_id
  cross join lateral (
    select c.handover_to_user_id as user_id, 'recipient' as role
    union select c.originator_user_id, 'escalated'
    union select a.user_id, 'escalated' from sweep_assigners a
  ) r
  join public.tenant_memberships m
    on m.tenant_id = c.tenant_id and m.user_id = r.user_id and m.status = 'active'
  where c.tenant_id = p_tenant and c.deleted_at is null and c.anonymized_at is null
    and s.kind = 'pending_acceptance' and c.handover_due_at < now()
    and c.handover_at is not null and r.user_id is not null
  on conflict do nothing;
  get diagnostics n = row_count;
  added := added + n;

  -- 4. Leads being worked that have gone quiet. Again after any new activity goes quiet.
  insert into public.notifications (tenant_id, user_id, type, title, url, dedupe_key)
  select p_tenant, c.owner_user_id, 'stale_lead',
    'No activity for ' || stale_days || ' days: ' || c.full_name, '/contacts/' || c.id,
    'stale-lead:' || c.id || ':' || to_char(coalesce(c.last_activity_at, c.created_at), 'YYYYMMDD')
  from public.contacts c
  join public.lead_statuses s on s.tenant_id = c.tenant_id and s.id = c.lead_status_id
  join public.tenant_memberships m
    on m.tenant_id = c.tenant_id and m.user_id = c.owner_user_id and m.status = 'active'
  where c.tenant_id = p_tenant and c.deleted_at is null and c.anonymized_at is null
    and s.kind in ('new', 'working', 'returned')
    and coalesce(c.last_activity_at, c.created_at) < now() - make_interval(days => stale_days)
  on conflict do nothing;
  get diagnostics n = row_count;
  added := added + n;

  -- 5. Open opportunities past their stage's own "stale after" days.
  insert into public.notifications (tenant_id, user_id, type, title, url, dedupe_key)
  select p_tenant, o.owner_user_id, 'stale_opportunity',
    'Gone quiet in ' || ps.name || ': ' || o.name, '/opportunities/' || o.id,
    'stale-opp:' || o.id || ':'
      || to_char(coalesce(o.last_activity_at, o.stage_entered_at), 'YYYYMMDD')
  from public.opportunities o
  join public.pipeline_stages ps on ps.tenant_id = o.tenant_id and ps.id = o.stage_id
  join public.tenant_memberships m
    on m.tenant_id = o.tenant_id and m.user_id = o.owner_user_id and m.status = 'active'
  where o.tenant_id = p_tenant and o.deleted_at is null and o.status = 'open'
    and ps.stale_after_days is not null
    and coalesce(o.last_activity_at, o.stage_entered_at)
      < now() - make_interval(days => ps.stale_after_days)
  on conflict do nothing;
  get diagnostics n = row_count;
  added := added + n;

  -- 6. Tasks that went overdue in the last week (older ones were already flagged or forgotten).
  insert into public.notifications (tenant_id, user_id, type, title, url, dedupe_key)
  select p_tenant, t.assigned_to, 'task_overdue', 'Overdue: ' || t.title,
    case
      when t.contact_id is not null then '/contacts/' || t.contact_id
      when t.opportunity_id is not null then '/opportunities/' || t.opportunity_id
      else '/tasks'
    end,
    'task-overdue:' || t.id || ':' || to_char(t.due_at, 'YYYYMMDD')
  from public.tasks t
  join public.tenant_memberships m
    on m.tenant_id = t.tenant_id and m.user_id = t.assigned_to and m.status = 'active'
  where t.tenant_id = p_tenant and t.deleted_at is null and t.status = 'open'
    and t.due_at < now() and t.due_at > now() - interval '7 days'
  on conflict do nothing;
  get diagnostics n = row_count;
  added := added + n;

  return added;
end;
$$;
revoke all on function app.sweep_lead_alerts(uuid) from public;
