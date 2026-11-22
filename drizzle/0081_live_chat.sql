CREATE TABLE "livechat_visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"name" text,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livechat_visitors_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "livechat_visitors_size_check" CHECK (char_length(coalesce("livechat_visitors"."name", '')) <= 120 and char_length(coalesce("livechat_visitors"."email", '')) <= 200)
);
--> statement-breakpoint
ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_platform_check";--> statement-breakpoint
ALTER TABLE "livechat_visitors" ADD CONSTRAINT "livechat_visitors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livechat_visitors" ADD CONSTRAINT "livechat_visitors_account_fkey" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."social_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livechat_visitors" ADD CONSTRAINT "livechat_visitors_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."social_conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livechat_visitors_token_key" ON "livechat_visitors" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "livechat_visitors_account_idx" ON "livechat_visitors" USING btree ("tenant_id","account_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_check" CHECK ("social_accounts"."platform" in ('facebook', 'instagram', 'tiktok', 'whatsapp', 'email', 'livechat'));--> statement-breakpoint

-- Live chat (ADR-072): a sixth inbox channel under its own feature, `live_chat`.
create or replace function app.feature_enabled(tenant uuid, feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select feature is null or exists (
    select 1 from public.tenants t
    where t.id = tenant
      and (feature = any (t.features)
           or (feature = 'inbox'
               and t.features && array['social', 'email_channel', 'live_chat']::text[]))
  );
$$;
--> statement-breakpoint
create or replace function app.inbox_platform_enabled(p_tenant uuid, p_platform text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.feature_enabled(p_tenant, case p_platform when 'email' then 'email_channel'
                                                       when 'livechat' then 'live_chat'
                                                       else 'social' end);
$$;
--> statement-breakpoint

-- Visitors are written only by the public chat module (privileged, from the widget's key and the
-- visitor's token). People who read the inbox may see who a visitor said they were.
alter table "livechat_visitors" enable row level security;
--> statement-breakpoint
grant select on "livechat_visitors" to authenticated;
--> statement-breakpoint
create policy livechat_visitors_read on "livechat_visitors" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (select app.has_permission((select app.active_tenant_id()), 'social.view')));
--> statement-breakpoint
create policy feature_switch on "livechat_visitors" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'inbox')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'inbox')));
--> statement-breakpoint
create policy inbox_channel on "livechat_visitors" as restrictive for all to authenticated
  using (app.inbox_account_enabled(account_id))
  with check (app.inbox_account_enabled(account_id));
--> statement-breakpoint

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
                                'autoTicketPriority', 'allowedOrigins', 'greeting',
                                'requireEmail'))
     or (p_settings ? 'createLeadForUnknown'
         and jsonb_typeof(p_settings -> 'createLeadForUnknown') <> 'boolean')
     or (p_settings ? 'autoTicket' and jsonb_typeof(p_settings -> 'autoTicket') <> 'boolean')
     or (p_settings ? 'autoTicketPriority'
         and coalesce(p_settings ->> 'autoTicketPriority', '') not in ('low', 'normal', 'high', 'urgent'))
     or (p_settings ? 'leadSourceId'
         and jsonb_typeof(p_settings -> 'leadSourceId') not in ('string', 'null'))
     -- Live chat (ADR-072): the sites that may show the widget, as origins: https, or http on
     -- this machine for trying it out.
     or (p_settings ? 'allowedOrigins' and (
         jsonb_typeof(p_settings -> 'allowedOrigins') <> 'array'
         or jsonb_array_length(p_settings -> 'allowedOrigins') > 10
         or exists (select 1 from jsonb_array_elements(p_settings -> 'allowedOrigins') o
                    where jsonb_typeof(o) <> 'string'
                       or not (o #>> '{}' ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$'
                               or o #>> '{}' ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$'))))
     or (p_settings ? 'greeting' and jsonb_typeof(p_settings -> 'greeting') not in ('string', 'null'))
     or char_length(coalesce(p_settings ->> 'greeting', '')) > 300
     or (p_settings ? 'requireEmail' and jsonb_typeof(p_settings -> 'requireEmail') <> 'boolean') then
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
  -- What a live chat visitor told us about themselves (ADR-072): in their linked chats, and
  -- wherever they gave this contact's email address. Runs before the contact itself is cleared.
  update public.livechat_visitors v set name = null, email = null
  where v.tenant_id = t
    and (v.conversation_id in (select c.id from public.social_conversations c
                               where c.tenant_id = t and c.contact_id = p_contact)
         or v.email = (select k.email_normalized from public.contacts k
                       where k.tenant_id = t and k.id = p_contact));
  -- Which help articles they read is about them too (ADR-071).
  delete from public.kb_article_views where tenant_id = t and contact_id = p_contact;
  delete from public.kb_article_links where tenant_id = t and contact_id = p_contact;
  update public.audit_logs
  set changes = (
    select coalesce(jsonb_object_agg(key, '["•••", "•••"]'::jsonb), '{}'::jsonb)
    from jsonb_object_keys(changes) as key
  )
  where tenant_id = t and entity_type = 'contact' and entity_id = p_contact
    and changes is not null and jsonb_typeof(changes) = 'object';
end;
$function$;
