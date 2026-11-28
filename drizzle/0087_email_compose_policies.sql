-- Custom SQL migration file, put your code below! --
-- Compose (ADR-090). A signed-in person may write a message's composed email (`email_outbound`)
-- on their own outgoing message, but never the received email's details: `email_meta` holds
-- `verified`, which decides whether a sender is linked to a contact, and `email_message_id`
-- threads replies (ADR-070). Only the verified webhook writes those, through the privileged
-- client. The table-wide insert grant from 0072 otherwise let a session set them through the
-- REST API.
create policy social_messages_email_columns on "social_messages" as restrictive
  for insert to authenticated
  with check (
    email_meta is null and email_message_id is null
    and (email_outbound is null or direction = 'outbound')
  );
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
  -- Who a composed email went to, Cc and Bcc included (ADR-090): addresses are about people.
  update public.social_messages m
  set email_outbound = m.email_outbound - 'to' - 'cc' - 'bcc'
  from public.social_conversations c
  where m.tenant_id = t and c.tenant_id = t and m.conversation_id = c.id
    and c.contact_id = p_contact and m.email_outbound is not null;
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
  -- A "Not a customer" rule names their email address (ADR-073).
  delete from public.email_sender_rules r
  where r.tenant_id = t
    and r.email = (select k.email_normalized from public.contacts k
                   where k.tenant_id = t and k.id = p_contact);
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
