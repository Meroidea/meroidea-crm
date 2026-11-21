ALTER TABLE "social_conversations" ADD COLUMN "participant_avatar_path" text;--> statement-breakpoint
ALTER TABLE "social_messages" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_messages" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_check" CHECK ("social_accounts"."platform" in ('facebook', 'instagram', 'tiktok'));--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_status_check" CHECK ("social_accounts"."status" in ('active', 'needs_reconnect', 'disconnected'));--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_status_check" CHECK ("social_conversations"."status" in ('open', 'done'));--> statement-breakpoint
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_direction_check" CHECK ("social_messages"."direction" in ('inbound', 'outbound'));--> statement-breakpoint
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_status_check" CHECK ("social_messages"."status" in ('received', 'sending', 'sent', 'delivered', 'read', 'failed'));--> statement-breakpoint

-- Social inbox: real-time updates, saved media and receipts (ADR-065).

-- Sessions may set what the inbox itself changes: a retried reply's time, the media copied into
-- storage on import, and the customer's saved picture.
grant update (sent_at, delivered_at, read_at, attachments) on "social_messages" to authenticated;
--> statement-breakpoint
grant update (participant_avatar_path) on "social_conversations" to authenticated;
--> statement-breakpoint

-- Customers' photos, videos, voice notes and files, copied from the provider because its links
-- expire. Private: no storage policies, so only the server reaches it, after a permission check,
-- through src/server/storage.ts. Paths are chosen by the server: {tenant}/social/...
insert into storage.buckets (id, name, public, file_size_limit)
values ('social-media', 'social-media', false, 26214400)
on conflict (id) do nothing;
--> statement-breakpoint

-- Real time. A change to a conversation or a message is announced on the private Realtime
-- channel `social:<tenant id>`, carrying only the conversation's id: the browser then reloads
-- through the ordinary RLS-checked queries, so the channel never carries what anyone wrote.
-- realtime.send swallows its own errors (a warning), so a broadcast problem can never stop a
-- message being stored; it is called by the postgres role, hence security definer.
create or replace function app.social_broadcast_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Where Realtime is not installed (some test setups), there is simply nothing to announce.
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    begin
      perform realtime.send(
        jsonb_build_object('conversationId', new.conversation_id),
        'changed',
        'social:' || new.tenant_id::text,
        true
      );
    exception when others then
      raise warning 'social broadcast skipped: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
--> statement-breakpoint
create or replace function app.social_broadcast_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Where Realtime is not installed (some test setups), there is simply nothing to announce.
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    begin
      perform realtime.send(
        jsonb_build_object('conversationId', new.id),
        'changed',
        'social:' || new.tenant_id::text,
        true
      );
    exception when others then
      raise warning 'social broadcast skipped: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
--> statement-breakpoint
revoke execute on function app.social_broadcast_message(), app.social_broadcast_conversation()
  from public;
--> statement-breakpoint
create trigger social_messages_broadcast after insert or update on "social_messages"
  for each row execute function app.social_broadcast_message();
--> statement-breakpoint
create trigger social_conversations_broadcast after insert or update on "social_conversations"
  for each row execute function app.social_broadcast_conversation();
--> statement-breakpoint

-- Who may join `social:<tenant>`: an active member of that business holding social.view, while
-- the feature is on (app.has_permission) and the business is open. Realtime evaluates this when
-- a browser joins the channel, with the person's own token.
create or replace function app.social_channel_allowed(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_topic ~ '^social:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      app.has_permission(substr(p_topic, 8)::uuid, 'social.view')
      and exists (
        select 1 from public.tenants t
        where t.id = substr(p_topic, 8)::uuid and t.status not in ('suspended', 'awaiting_agreement')
      )
    else false
  end;
$$;
--> statement-breakpoint
revoke execute on function app.social_channel_allowed(text) from public;
--> statement-breakpoint
grant execute on function app.social_channel_allowed(text) to authenticated;
--> statement-breakpoint
do $$
begin
  if to_regclass('realtime.messages') is not null then
    create policy social_inbox_receive on "realtime"."messages" for select to authenticated
      using (
        "realtime"."messages"."extension" = 'broadcast'
        and (select app.social_channel_allowed((select realtime.topic())))
      );
  end if;
end $$;
--> statement-breakpoint

-- Erasing a person on request (docs/leads.md §6.5) now reaches what they sent on social media
-- too, in conversations linked to their record: their messages' words and media, their name,
-- handle and picture. The business's own replies are kept, as for support tickets. The saved
-- media files are listed first by app.social_media_paths_for_contact and removed from storage
-- by the application.
create or replace function app.social_media_paths_for_contact(p_contact uuid)
returns setof text
language sql stable security definer set search_path = '' as $$
  select path from (
    select a ->> 'storagePath' as path
    from public.social_messages m
    join public.social_conversations c on c.tenant_id = m.tenant_id and c.id = m.conversation_id
    cross join lateral jsonb_array_elements(m.attachments) as a
    where c.tenant_id = (select app.active_tenant_id()) and c.contact_id = p_contact
      and m.direction = 'inbound' and jsonb_typeof(m.attachments) = 'array'
    union all
    select c.participant_avatar_path
    from public.social_conversations c
    where c.tenant_id = (select app.active_tenant_id()) and c.contact_id = p_contact
  ) paths
  where path is not null
    and (select app.active_tenant_id()) in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'contacts.anonymize'));
$$;
--> statement-breakpoint
revoke execute on function app.social_media_paths_for_contact(uuid) from public;
--> statement-breakpoint
grant execute on function app.social_media_paths_for_contact(uuid) to authenticated;
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
  set body = 'Erased on request', attachments = '[]'::jsonb
  from public.social_conversations c
  where m.tenant_id = t and c.tenant_id = t and m.conversation_id = c.id
    and c.contact_id = p_contact and m.direction = 'inbound';
  update public.social_conversations
  set participant_name = 'Erased', participant_username = null, participant_avatar_path = null,
      last_message_preview = null
  where tenant_id = t and contact_id = p_contact;
  update public.audit_logs
  set changes = (
    select coalesce(jsonb_object_agg(key, '["•••", "•••"]'::jsonb), '{}'::jsonb)
    from jsonb_object_keys(changes) as key
  )
  where tenant_id = t and entity_type = 'contact' and entity_id = p_contact
    and changes is not null and jsonb_typeof(changes) = 'object';
end;
$function$;
