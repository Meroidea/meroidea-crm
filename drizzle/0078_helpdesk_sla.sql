CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"weekly" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skip_public_holidays" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "business_hours_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "business_hours_weekly_check" CHECK (jsonb_typeof("business_hours"."weekly") = 'array')
);
--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"business_hours_id" uuid,
	"at_risk_percent" smallint DEFAULT 75 NOT NULL,
	"escalate_to_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sla_policies_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sla_policies_at_risk_check" CHECK ("sla_policies"."at_risk_percent" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "sla_targets" (
	"tenant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"first_response_minutes" integer NOT NULL,
	"resolution_minutes" integer NOT NULL,
	CONSTRAINT "sla_targets_policy_id_priority_pk" PRIMARY KEY("policy_id","priority"),
	CONSTRAINT "sla_targets_priority_check" CHECK ("sla_targets"."priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "sla_targets_minutes_check" CHECK ("sla_targets"."first_response_minutes" between 1 and 525600 and "sla_targets"."resolution_minutes" between 1 and 525600 and "sla_targets"."resolution_minutes" >= "sla_targets"."first_response_minutes")
);
--> statement-breakpoint
CREATE TABLE "ticket_opportunities" (
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ticket_opportunities_ticket_id_opportunity_id_pk" PRIMARY KEY("ticket_id","opportunity_id")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sla_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "resolution_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_response_at_risk_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "resolution_at_risk_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sla_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sla_paused_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_response_breached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "resolution_breached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_hours_fkey" FOREIGN KEY ("tenant_id","business_hours_id") REFERENCES "public"."business_hours"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_escalate_fkey" FOREIGN KEY ("tenant_id","escalate_to_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_targets" ADD CONSTRAINT "sla_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_targets" ADD CONSTRAINT "sla_targets_policy_fkey" FOREIGN KEY ("tenant_id","policy_id") REFERENCES "public"."sla_policies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_opportunities" ADD CONSTRAINT "ticket_opportunities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_opportunities" ADD CONSTRAINT "ticket_opportunities_ticket_fkey" FOREIGN KEY ("tenant_id","ticket_id") REFERENCES "public"."tickets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_opportunities" ADD CONSTRAINT "ticket_opportunities_opportunity_fkey" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policies_one_default_key" ON "sla_policies" USING btree ("tenant_id") WHERE "sla_policies"."is_default";--> statement-breakpoint
CREATE INDEX "ticket_opportunities_opportunity_idx" ON "ticket_opportunities" USING btree ("tenant_id","opportunity_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contact_fkey" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_fkey" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."social_conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sla_policy_fkey" FOREIGN KEY ("tenant_id","sla_policy_id") REFERENCES "public"."sla_policies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_conversation_idx" ON "tickets" USING btree ("tenant_id","conversation_id") WHERE "tickets"."conversation_id" is not null;--> statement-breakpoint
CREATE INDEX "tickets_sla_idx" ON "tickets" USING btree ("response_due_at","resolution_due_at") WHERE "tickets"."deleted_at" is null and "tickets"."status" in ('open', 'pending', 'on_hold');--> statement-breakpoint

-- Ticketing with response targets (ADR-069). Everything about SLA time is worked out here, in
-- the database, so a ticket changed by staff, by a customer on their ticket page or by a channel
-- webhook follows exactly the same rules.

-- A ticket can now come from an inbox conversation (0040 allowed the form and staff only).
alter table "tickets" drop constraint tickets_source_known;
--> statement-breakpoint
alter table "tickets" add constraint tickets_source_known
  check (source in ('web_form', 'manual', 'conversation'));
--> statement-breakpoint

-- Opening hours are a list of { day: 0-6 (Sunday 0), opens: "HH:MM", closes: "HH:MM" } with
-- opens before closes ("24:00" closes at midnight). At least one is needed.
create or replace function app.business_minute_of_day(p_hhmm text) returns integer
language sql immutable set search_path = '' as $$
  select split_part(p_hhmm, ':', 1)::integer * 60 + split_part(p_hhmm, ':', 2)::integer;
$$;
--> statement-breakpoint
create or replace function app.valid_business_week(p_weekly jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_weekly) = 'array'
    and jsonb_array_length(p_weekly) between 1 and 70
    and not exists (
      select 1 from jsonb_array_elements(p_weekly) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(e ->> 'day', '') !~ '^[0-6]$'
         or coalesce(e ->> 'opens', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(e ->> 'closes', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
         or app.business_minute_of_day(e ->> 'opens')
            >= app.business_minute_of_day(e ->> 'closes')
    );
$$;
--> statement-breakpoint
-- A timezone Postgres knows (an unknown one would stop every SLA calculation for the business).
create or replace function app.valid_timezone(p_zone text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  perform now() at time zone p_zone;
  return true;
exception when others then
  return false;
end $$;
--> statement-breakpoint
alter table "business_hours" add constraint business_hours_week_check
  check (app.valid_business_week(weekly));
--> statement-breakpoint
alter table "business_hours" add constraint business_hours_timezone_check
  check (app.valid_timezone(timezone));
--> statement-breakpoint

-- The moment p_minutes of counted time have passed after p_from: every minute without business
-- hours, otherwise only minutes inside the opening hours, in the hours' own timezone (daylight
-- saving included), skipping the business's public holidays when asked to. Overlapping hours
-- count once. Readable by the privileged connection, or by a member of the hours' business.
create or replace function app.business_add(p_hours uuid, p_from timestamptz, p_minutes numeric)
returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  h public.business_hours;
  v_day date;
  v_left numeric := p_minutes;
  v_cursor timestamptz := p_from;
  v_open timestamptz;
  v_close timestamptz;
  v_start timestamptz;
  v_seg numeric;
  iv jsonb;
begin
  if p_from is null or p_minutes is null then return null; end if;
  if p_hours is null then return p_from + make_interval(secs => p_minutes * 60); end if;
  select * into h from public.business_hours b where b.id = p_hours;
  if not found then return p_from + make_interval(secs => p_minutes * 60); end if;
  if (select auth.uid()) is not null and not (h.tenant_id in (select app.tenant_ids())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_minutes <= 0 then return p_from; end if;
  v_day := (p_from at time zone h.timezone)::date - 1;
  -- Two years of days is far beyond any target (the longest is a year of counted minutes).
  for i in 0 .. 1500 loop
    if not (h.skip_public_holidays and exists (
      select 1 from public.public_holidays ph where ph.tenant_id = h.tenant_id and ph.day = v_day
    )) then
      for iv in
        select e from jsonb_array_elements(h.weekly) e
        where (e ->> 'day')::int = extract(dow from v_day)::int
        order by e ->> 'opens'
      loop
        v_open := (v_day + (iv ->> 'opens')::time) at time zone h.timezone;
        v_close := case when iv ->> 'closes' = '24:00'
                        then (v_day + 1)::timestamp at time zone h.timezone
                        else (v_day + (iv ->> 'closes')::time) at time zone h.timezone end;
        v_start := greatest(v_open, v_cursor);
        if v_close > v_start then
          v_seg := extract(epoch from (v_close - v_start)) / 60;
          if v_seg >= v_left then
            return v_start + make_interval(secs => v_left * 60);
          end if;
          v_left := v_left - v_seg;
          v_cursor := v_close;
        end if;
      end loop;
    end if;
    v_day := v_day + 1;
  end loop;
  raise exception 'these business hours have no open time' using errcode = '22023';
end $$;
--> statement-breakpoint

-- Counted minutes between two moments, by the same rules as app.business_add.
create or replace function app.business_minutes_between(p_hours uuid, p_from timestamptz,
  p_to timestamptz)
returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  h public.business_hours;
  v_day date;
  v_total numeric := 0;
  v_cursor timestamptz := p_from;
  v_open timestamptz;
  v_close timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  iv jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from then return 0; end if;
  if p_hours is not null then
    select * into h from public.business_hours b where b.id = p_hours;
  end if;
  if p_hours is null or h.id is null then
    return round(extract(epoch from (p_to - p_from)) / 60);
  end if;
  if (select auth.uid()) is not null and not (h.tenant_id in (select app.tenant_ids())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_day := (p_from at time zone h.timezone)::date - 1;
  while ((v_day - 1)::timestamp at time zone h.timezone) < p_to loop
    if not (h.skip_public_holidays and exists (
      select 1 from public.public_holidays ph where ph.tenant_id = h.tenant_id and ph.day = v_day
    )) then
      for iv in
        select e from jsonb_array_elements(h.weekly) e
        where (e ->> 'day')::int = extract(dow from v_day)::int
        order by e ->> 'opens'
      loop
        v_open := (v_day + (iv ->> 'opens')::time) at time zone h.timezone;
        v_close := case when iv ->> 'closes' = '24:00'
                        then (v_day + 1)::timestamp at time zone h.timezone
                        else (v_day + (iv ->> 'closes')::time) at time zone h.timezone end;
        v_start := greatest(v_open, v_cursor);
        v_end := least(v_close, p_to);
        if v_end > v_start then
          v_total := v_total + extract(epoch from (v_end - v_start)) / 60;
          v_cursor := v_end;
        end if;
      end loop;
    end if;
    v_day := v_day + 1;
  end loop;
  return round(v_total);
end $$;
--> statement-breakpoint
revoke execute on function app.business_add(uuid, timestamptz, numeric),
  app.business_minutes_between(uuid, timestamptz, timestamptz) from public;
--> statement-breakpoint
grant execute on function app.business_add(uuid, timestamptz, numeric),
  app.business_minutes_between(uuid, timestamptz, timestamptz) to authenticated;
--> statement-breakpoint

-- The ticket's SLA, kept by the database (trigger tickets_sla):
-- * A new ticket gets the business's default policy, and its due and at-risk times are worked
--   out from when it was made. The first response is due by the target whatever the status.
-- * The resolution clock stands still while the ticket waits on the customer (pending) or is
--   solved or closed, and runs again when it is reopened: the standing time is added up in
--   counted minutes and every resolution time moves on by it.
-- * Changing the priority or policy works the times out again; a breach whose new time has not
--   come yet is lifted.
-- * A first response is recorded once, at the moment it is made.
create or replace function app.tickets_sla() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hours uuid;
  v_pct integer;
  v_first integer;
  v_resolve integer;
  v_recompute boolean := false;
  v_stopped_old boolean;
  v_stopped_new boolean := new.status in ('pending', 'solved', 'closed');
begin
  if tg_op = 'INSERT' then
    new.first_response_at := null;
    new.first_response_breached_at := null;
    new.resolution_breached_at := null;
    new.sla_paused_minutes := 0;
    new.sla_paused_at := case when v_stopped_new then now() end;
    if new.sla_policy_id is null then
      select p.id into new.sla_policy_id from public.sla_policies p
      where p.tenant_id = new.tenant_id and p.is_default;
    end if;
    v_recompute := true;
  else
    if old.first_response_at is not null then
      new.first_response_at := old.first_response_at;
    elsif new.first_response_at is not null then
      new.first_response_at := now();
    end if;
    v_stopped_old := old.status in ('pending', 'solved', 'closed');
    if not v_stopped_old and v_stopped_new then
      new.sla_paused_at := now();
    elsif v_stopped_old and not v_stopped_new then
      if old.sla_paused_at is not null then
        select p.business_hours_id into v_hours from public.sla_policies p
        where p.tenant_id = new.tenant_id and p.id = new.sla_policy_id;
        new.sla_paused_minutes := old.sla_paused_minutes
          + app.business_minutes_between(v_hours, old.sla_paused_at, now());
      end if;
      new.sla_paused_at := null;
      v_recompute := true;
    end if;
    if new.priority is distinct from old.priority
       or new.sla_policy_id is distinct from old.sla_policy_id then
      v_recompute := true;
    end if;
  end if;

  if v_recompute and new.sla_policy_id is not null then
    select p.business_hours_id, p.at_risk_percent, t.first_response_minutes, t.resolution_minutes
      into v_hours, v_pct, v_first, v_resolve
    from public.sla_policies p
    join public.sla_targets t on t.policy_id = p.id and t.priority = new.priority
    where p.tenant_id = new.tenant_id and p.id = new.sla_policy_id;
    if found then
      new.response_due_at := app.business_add(v_hours, new.created_at, v_first);
      new.first_response_at_risk_at :=
        app.business_add(v_hours, new.created_at, greatest(1, v_first * v_pct / 100.0));
      new.resolution_due_at :=
        app.business_add(v_hours, new.created_at, v_resolve + new.sla_paused_minutes);
      new.resolution_at_risk_at := app.business_add(v_hours, new.created_at,
        greatest(1, v_resolve * v_pct / 100.0) + new.sla_paused_minutes);
      if new.first_response_at is null and new.response_due_at > now() then
        new.first_response_breached_at := null;
      end if;
      if new.resolution_due_at > now() then
        new.resolution_breached_at := null;
      end if;
    end if;
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger tickets_sla before insert or update on "tickets"
  for each row execute function app.tickets_sla();
--> statement-breakpoint

-- Sessions may change only what working a ticket changes. The SLA columns are the trigger's and
-- the sweep's alone (the table was granted whole in 0040 and 0054).
revoke update on "tickets" from authenticated;
--> statement-breakpoint
grant update (status, priority, category, assignee_user_id, first_response_at, solved_at,
  last_activity_at, updated_at, updated_by, deleted_at, contact_id, organization_id)
  on "tickets" to authenticated;
--> statement-breakpoint

-- Business hours, policies and targets: read by anyone who works tickets, written with
-- tickets.manage. The ticket links: read and written by anyone who works tickets.
alter table "business_hours" enable row level security;
--> statement-breakpoint
alter table "sla_policies" enable row level security;
--> statement-breakpoint
alter table "sla_targets" enable row level security;
--> statement-breakpoint
alter table "ticket_opportunities" enable row level security;
--> statement-breakpoint
grant select, insert, update, delete on "business_hours", "sla_policies", "sla_targets"
  to authenticated;
--> statement-breakpoint
grant select, insert, delete on "ticket_opportunities" to authenticated;
--> statement-breakpoint
do $$
declare t text;
begin
  foreach t in array array['business_hours', 'sla_policies', 'sla_targets'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
         and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_read', t, 'tickets.work');
    execute format(
      'create policy %I on public.%I for all to authenticated using (
         tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
         and (select app.has_permission((select app.active_tenant_id()), %L)))
       with check (
         tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
         and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_write', t, 'tickets.manage', 'tickets.manage');
  end loop;
  foreach t in array array['business_hours', 'sla_policies', 'sla_targets', 'ticket_opportunities']
  loop
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'helpdesk', 'helpdesk');
  end loop;
end $$;
--> statement-breakpoint
create policy ticket_opportunities_all on "ticket_opportunities" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))
  );
--> statement-breakpoint

-- Every business starts with one policy, "Standard", around the clock: first responses as
-- ADR-037 had them (urgent 1 h, high 4 h, normal 24 h, low 72 h) and resolutions within 4 h,
-- 1 day, 3 days and 7 days. The business changes them in Helpdesk → Response targets.
create or replace function app.create_default_sla_policy(p_tenant uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_policy uuid;
begin
  select id into v_policy from public.sla_policies where tenant_id = p_tenant and is_default;
  if v_policy is not null then return v_policy; end if;
  insert into public.sla_policies (tenant_id, name, is_default)
  values (p_tenant, 'Standard', true) returning id into v_policy;
  insert into public.sla_targets (tenant_id, policy_id, priority, first_response_minutes,
    resolution_minutes)
  values (p_tenant, v_policy, 'urgent', 60, 240),
         (p_tenant, v_policy, 'high', 240, 1440),
         (p_tenant, v_policy, 'normal', 1440, 4320),
         (p_tenant, v_policy, 'low', 4320, 10080);
  return v_policy;
end $$;
--> statement-breakpoint
revoke execute on function app.create_default_sla_policy(uuid) from public;
--> statement-breakpoint
select app.create_default_sla_policy(id) from public.tenants;
--> statement-breakpoint

-- Tickets still being worked join their business's policy. One already waiting on the customer
-- or solved starts its standing time now.
update public.tickets t
set sla_policy_id = p.id,
    sla_paused_at = case when t.status in ('pending', 'solved') then now() end
from public.sla_policies p
where p.tenant_id = t.tenant_id and p.is_default
  and t.deleted_at is null and t.status in ('open', 'pending', 'on_hold', 'solved');
--> statement-breakpoint

-- Every five minutes: mark targets that have passed, and tell people about tickets at risk or
-- breached. A notice says only which ticket and which target, never what the customer wrote,
-- and lands once (dedupe key). The assignee hears about both; a breach also reaches the policy's
-- escalation person; with nobody to tell, everyone who can manage tickets hears.
create or replace function app.sla_sweep() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_count integer := 0;
  v_kind text;
  v_target text;
  v_breach boolean;
  v_title text;
begin
  for r in
    select t.id, t.tenant_id, t.number, t.assignee_user_id, p.escalate_to_user_id,
      (t.first_response_at is null and t.first_response_breached_at is null
        and t.response_due_at <= now()) as first_breach,
      (t.first_response_at is null and t.first_response_breached_at is null
        and t.first_response_at_risk_at <= now() and t.response_due_at > now()) as first_risk,
      (t.sla_paused_at is null and t.resolution_breached_at is null
        and t.resolution_due_at <= now()) as resolve_breach,
      (t.sla_paused_at is null and t.resolution_breached_at is null
        and t.resolution_at_risk_at <= now() and t.resolution_due_at > now()) as resolve_risk
    from public.tickets t
    join public.tenants tn on tn.id = t.tenant_id
    left join public.sla_policies p on p.tenant_id = t.tenant_id and p.id = t.sla_policy_id
    where t.deleted_at is null
      and t.status in ('open', 'pending', 'on_hold')
      and t.sla_policy_id is not null
      and tn.status in ('trialing', 'active', 'past_due')
      and 'helpdesk' = any (tn.features)
      and ((t.first_response_at is null and t.first_response_breached_at is null
            and t.first_response_at_risk_at <= now())
        or (t.sla_paused_at is null and t.resolution_breached_at is null
            and t.resolution_at_risk_at <= now()))
  loop
    if r.first_breach then
      update public.tickets set first_response_breached_at = response_due_at
      where tenant_id = r.tenant_id and id = r.id;
    end if;
    if r.resolve_breach then
      update public.tickets set resolution_breached_at = resolution_due_at
      where tenant_id = r.tenant_id and id = r.id;
    end if;
    foreach v_kind in array array['first_risk', 'first_breach', 'resolve_risk', 'resolve_breach']
    loop
      continue when not (case v_kind when 'first_risk' then r.first_risk
                                     when 'first_breach' then r.first_breach
                                     when 'resolve_risk' then r.resolve_risk
                                     else r.resolve_breach end);
      v_breach := v_kind like '%breach';
      v_target := case when v_kind like 'first%' then 'first response' else 'resolution' end;
      v_title := 'Ticket #' || r.number || case when v_breach then ' missed its ' else ' is close to its ' end
        || v_target || ' target';
      insert into public.notifications (tenant_id, user_id, type, title, url, dedupe_key)
      select r.tenant_id, m.user_id, case when v_breach then 'sla_breached' else 'sla_at_risk' end,
        v_title, '/helpdesk/' || r.id, 'sla:' || r.id || ':' || v_kind
      from public.tenant_memberships m
      where m.tenant_id = r.tenant_id and m.status = 'active'
        and (
          m.user_id = r.assignee_user_id
          or (v_breach and m.user_id = r.escalate_to_user_id)
          or (r.assignee_user_id is null and (not v_breach or r.escalate_to_user_id is null)
              and not m.is_support
              and exists (select 1 from public.role_permissions rp
                          where rp.role_id = m.role_id and rp.permission = 'tickets.manage'))
        )
      on conflict (tenant_id, user_id, dedupe_key) do nothing;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;
--> statement-breakpoint
revoke execute on function app.sla_sweep() from public;
--> statement-breakpoint
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sla_sweep', '*/5 * * * *', 'select app.sla_sweep()');
  end if;
end $$;
--> statement-breakpoint

-- Inbox accounts may open a ticket for each new conversation (ADR-069), at a chosen priority.
create or replace function app.social_set_account_settings(p_account uuid, p_settings jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.active_tenant_id();
  v_source uuid;
begin
  if v_tenant is null or not (v_tenant in (select app.tenant_ids()))
     or not app.has_permission(v_tenant, 'social.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_settings) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_settings) k
                where k not in ('createLeadForUnknown', 'leadSourceId', 'autoTicket',
                                'autoTicketPriority'))
     or (p_settings ? 'createLeadForUnknown'
         and jsonb_typeof(p_settings -> 'createLeadForUnknown') <> 'boolean')
     or (p_settings ? 'autoTicket' and jsonb_typeof(p_settings -> 'autoTicket') <> 'boolean')
     or (p_settings ? 'autoTicketPriority'
         and coalesce(p_settings ->> 'autoTicketPriority', '') not in ('low', 'normal', 'high', 'urgent'))
     or (p_settings ? 'leadSourceId'
         and jsonb_typeof(p_settings -> 'leadSourceId') not in ('string', 'null')) then
    raise exception 'unknown settings' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'leadSourceId') = 'string' then
    v_source := (p_settings ->> 'leadSourceId')::uuid;
    if not exists (select 1 from public.lead_sources s
                   where s.tenant_id = v_tenant and s.id = v_source) then
      raise exception 'no such lead source' using errcode = '22023';
    end if;
  end if;
  update public.social_accounts
  set settings = p_settings, updated_at = now()
  where tenant_id = v_tenant and id = p_account and disconnected_at is null;
  if not found then
    raise exception 'no such connected account' using errcode = 'P0002';
  end if;
end $$;
--> statement-breakpoint

-- After a business changes its targets or hours, the tickets it is still working follow them:
-- clearing and setting the policy again makes the trigger work each ticket's times out anew
-- (standing time already counted is kept). Needs tickets.manage.
create or replace function app.sla_reapply_policy(p_policy uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.active_tenant_id();
  v_ids uuid[];
begin
  if v_tenant is null or not (v_tenant in (select app.tenant_ids()))
     or not app.has_permission(v_tenant, 'tickets.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sla_policies where tenant_id = v_tenant and id = p_policy) then
    raise exception 'no such policy' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.tickets
  where tenant_id = v_tenant and sla_policy_id = p_policy and deleted_at is null
    and status in ('open', 'pending', 'on_hold');
  update public.tickets set sla_policy_id = null where tenant_id = v_tenant and id = any (v_ids);
  update public.tickets set sla_policy_id = p_policy where tenant_id = v_tenant and id = any (v_ids);
  return coalesce(array_length(v_ids, 1), 0);
end $$;
--> statement-breakpoint
revoke execute on function app.sla_reapply_policy(uuid) from public;
--> statement-breakpoint
grant execute on function app.sla_reapply_policy(uuid) to authenticated;
