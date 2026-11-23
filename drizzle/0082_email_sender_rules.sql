CREATE TABLE "email_sender_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"kind" text DEFAULT 'not_customer' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_sender_rules_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "email_sender_rules_email_key" UNIQUE("tenant_id","email"),
	CONSTRAINT "email_sender_rules_kind_check" CHECK ("email_sender_rules"."kind" in ('not_customer')),
	CONSTRAINT "email_sender_rules_email_check" CHECK (char_length("email_sender_rules"."email") between 3 and 200 and "email_sender_rules"."email" = lower("email_sender_rules"."email"))
);
--> statement-breakpoint
ALTER TABLE "email_sender_rules" ADD CONSTRAINT "email_sender_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sender_rules" ADD CONSTRAINT "email_sender_rules_created_by_fkey" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The Email sub-module's sender rules (ADR-073). Reading needs social.view, like the inbox it
-- sorts; marking a sender "Not a customer" or moving them back needs social.reply, as yourself.
alter table "email_sender_rules" enable row level security;
--> statement-breakpoint
grant select, insert, delete on "email_sender_rules" to authenticated;
--> statement-breakpoint
create policy email_sender_rules_read on "email_sender_rules" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.view'))
  );
--> statement-breakpoint
create policy email_sender_rules_insert on "email_sender_rules" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and created_by = (select auth.uid())
    and (select app.has_permission((select app.active_tenant_id()), 'social.reply'))
  );
--> statement-breakpoint
create policy email_sender_rules_delete on "email_sender_rules" for delete to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.reply'))
  );
--> statement-breakpoint
create policy feature_switch on "email_sender_rules" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'email_channel')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'email_channel')));
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
