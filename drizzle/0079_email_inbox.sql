ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_platform_check";--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "participant_email" text;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "reply_token" text;--> statement-breakpoint
ALTER TABLE "social_messages" ADD COLUMN "email_message_id" text;--> statement-breakpoint
ALTER TABLE "social_messages" ADD COLUMN "email_meta" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "social_conversations_reply_token_key" ON "social_conversations" USING btree ("reply_token") WHERE "social_conversations"."reply_token" is not null;--> statement-breakpoint
CREATE INDEX "social_conversations_email_idx" ON "social_conversations" USING btree ("tenant_id","participant_email") WHERE "social_conversations"."participant_email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "social_messages_email_message_key" ON "social_messages" USING btree ("account_id","email_message_id") WHERE "social_messages"."email_message_id" is not null;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_check" CHECK ("social_accounts"."platform" in ('facebook', 'instagram', 'tiktok', 'whatsapp', 'email'));--> statement-breakpoint

-- Email inbox (ADR-070). Email arrives as a fifth inbox channel, under its own feature
-- `email_channel`, sharing the inbox's tables and permissions with social media.

-- The inbox's permissions (the `social` family) count as granted while either inbox feature is
-- on: `app.permission_feature` names them by the group `inbox`, which `app.feature_enabled`
-- understands. src/lib/features.ts (FEATURE_GROUPS) is the twin of this.
create or replace function app.permission_feature(perm text) returns text
language sql immutable set search_path = '' as $$
  select case split_part(perm, '.', 1)
    when 'contacts' then 'crm'
    when 'opportunities' then 'crm'
    when 'revenue' then 'crm'
    when 'activities' then 'crm'
    when 'documents' then 'crm'
    when 'partners' then 'crm'
    when 'organizations' then 'crm'
    when 'products' then 'crm'
    when 'reports' then 'crm'
    when 'tasks' then 'tasks'
    when 'rosters' then 'roster'
    when 'timeoff' then 'timeoff'
    when 'timesheets' then 'timesheets'
    when 'employees' then 'staff'
    when 'recruitment' then 'recruitment'
    when 'reviews' then 'reviews'
    when 'tickets' then 'helpdesk'
    when 'projects' then 'projects'
    when 'productivity' then 'productivity'
    when 'inventory' then 'inventory'
    when 'purchasing' then 'purchasing'
    when 'files' then 'files'
    when 'invoices' then 'invoices'
    when 'expenses' then 'expenses'
    when 'payroll' then 'payroll'
    when 'concerns' then 'concerns'
    when 'training' then 'training'
    when 'books' then 'books'
    when 'social' then 'inbox'
    else null
  end;
$$;
--> statement-breakpoint
create or replace function app.feature_enabled(tenant uuid, feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select feature is null or exists (
    select 1 from public.tenants t
    where t.id = tenant
      and (feature = any (t.features)
           or (feature = 'inbox' and t.features && array['social', 'email_channel']::text[]))
  );
$$;
--> statement-breakpoint
-- The request context's live grants follow the same rule.
create or replace function app.my_context(preferred uuid default null)
returns table (
  tenant_id uuid,
  membership_id uuid,
  role_key text,
  role_name text,
  tenant_name text,
  tenant_slug text,
  tenant_timezone text,
  tenant_currency char(3),
  tenant_country char(2),
  tenant_primary_color text,
  tenant_status text,
  tenant_labels jsonb,
  tenant_settings jsonb,
  grants jsonb,
  tenant_features text[],
  is_support boolean,
  location_latitude numeric,
  location_longitude numeric,
  clock_radius_metres integer,
  team_user_ids uuid[],
  tenant_legal_name text,
  tenant_business_number text
)
language sql stable security definer set search_path = '' as $$
  select
    t.id,
    m.id,
    r.key,
    r.name,
    t.name,
    t.slug,
    t.timezone,
    t.default_currency,
    t.default_country,
    t.primary_color,
    t.status::text,
    t.labels,
    t.settings,
    coalesce(
      (select jsonb_object_agg(rp.permission, coalesce(rp.scope::text, 'true'))
       from public.role_permissions rp
       where rp.role_id = r.id and rp.tenant_id = t.id
         and app.feature_enabled(t.id, app.permission_feature(rp.permission))),
      '{}'::jsonb
    ),
    t.features,
    m.is_support,
    t.location_latitude,
    t.location_longitude,
    t.clock_radius_metres,
    array(
      select distinct colleague.user_id
      from public.tenant_memberships colleague
      where colleague.tenant_id = t.id
        and colleague.status = 'active'
        and (
          colleague.user_id = m.user_id
          or (m.team_id is not null and colleague.team_id = m.team_id)
          or colleague.team_id in (
            select team.id from public.teams team
            where team.tenant_id = t.id and team.manager_user_id = m.user_id
          )
        )
    ),
    t.legal_name,
    t.business_number
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.id = m.role_id and r.tenant_id = m.tenant_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and (preferred is null or t.id = preferred)
  order by (t.id is not distinct from preferred) desc, m.created_at
  limit 1;
$$;
--> statement-breakpoint

-- Each account follows its own channel's feature: email with email_channel, the others with
-- social. A business with only one of them switched on sees nothing of the other's accounts,
-- conversations, messages or templates.
create or replace function app.inbox_platform_enabled(p_tenant uuid, p_platform text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.feature_enabled(p_tenant, case when p_platform = 'email' then 'email_channel'
                                            else 'social' end);
$$;
--> statement-breakpoint
create or replace function app.inbox_account_enabled(p_account uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select app.inbox_platform_enabled(a.tenant_id, a.platform)
    from public.social_accounts a where a.id = p_account
  ), false);
$$;
--> statement-breakpoint
revoke execute on function app.inbox_platform_enabled(uuid, text), app.inbox_account_enabled(uuid)
  from public;
--> statement-breakpoint
grant execute on function app.inbox_platform_enabled(uuid, text), app.inbox_account_enabled(uuid)
  to authenticated;
--> statement-breakpoint
do $$
declare t text;
begin
  foreach t in array array['social_accounts', 'social_account_credentials',
                           'social_conversations', 'social_messages',
                           'social_message_templates', 'social_canned_responses'] loop
    execute format('drop policy if exists feature_switch on public.%I', t);
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'inbox', 'inbox');
  end loop;
  foreach t in array array['social_account_credentials', 'social_conversations',
                           'social_messages', 'social_message_templates'] loop
    execute format(
      'create policy inbox_channel on public.%I as restrictive for all to authenticated
         using (app.inbox_account_enabled(account_id))
         with check (app.inbox_account_enabled(account_id))', t);
  end loop;
end $$;
--> statement-breakpoint
create policy inbox_channel on "social_accounts" as restrictive for all to authenticated
  using (app.inbox_platform_enabled(tenant_id, platform))
  with check (app.inbox_platform_enabled(tenant_id, platform));
--> statement-breakpoint

-- Erasing a person on request also clears what their emails told us: their address, the
-- thread's subject and each message's sender and recipients.
CREATE OR REPLACE FUNCTION app.erase_contact_traces(p_contact uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t uuid := app.active_tenant_id();
begin
  if t is null or t not in (select app.tenant_ids())
     or not app.has_permission(t, 'contacts.anonymize') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts where tenant_id = t and id = p_contact) then
    raise exception 'record not found' using errcode = 'P0002';
  end if;

  update public.lead_intake_events set payload = '{"erased": true}'::jsonb
  where tenant_id = t and contact_id = p_contact;
  update public.ticket_messages m
  set author_name = 'Erased', body = 'Erased on request'
  from public.tickets tk
  where m.tenant_id = t and tk.tenant_id = t and m.ticket_id = tk.id
    and tk.contact_id = p_contact
    and (m.author_user_id is null or m.author_name like '% (logged by staff)');
  update public.tickets set requester_name = 'Erased', requester_email = null
  where tenant_id = t and contact_id = p_contact;
  update public.customer_reviews set customer_name = null, customer_email = null
  where tenant_id = t and contact_id = p_contact;
  update public.social_messages m
  set body = 'Erased on request', attachments = '[]'::jsonb, email_meta = null
  from public.social_conversations c
  where m.tenant_id = t and c.tenant_id = t and m.conversation_id = c.id
    and c.contact_id = p_contact and m.direction = 'inbound';
  update public.social_conversations c
  set participant_name = 'Erased', participant_username = null, participant_avatar_path = null,
      last_message_preview = null, participant_phone = null, participant_email = null,
      subject = null,
      participant_id = case when a.platform = 'whatsapp' then 'erased:' || c.id::text
                            else c.participant_id end
  from public.social_accounts a
  where c.tenant_id = t and a.tenant_id = t and a.id = c.account_id and c.contact_id = p_contact;
  update public.audit_logs
  set changes = (
    select coalesce(jsonb_object_agg(key, '["•••", "•••"]'::jsonb), '{}'::jsonb)
    from jsonb_object_keys(changes) as key
  )
  where tenant_id = t and entity_type = 'contact' and entity_id = p_contact
    and changes is not null and jsonb_typeof(changes) = 'object';
end;
$function$;
