CREATE TABLE "social_message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"parameter_format" text DEFAULT 'positional' NOT NULL,
	"body" text NOT NULL,
	"header_text" text,
	"footer_text" text,
	"parameters" text[] DEFAULT '{}'::text[] NOT NULL,
	"sendable" boolean DEFAULT true NOT NULL,
	"reason" text,
	"created_by" uuid,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_message_templates_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "social_message_templates_external_key" UNIQUE("account_id","external_id"),
	CONSTRAINT "social_message_templates_format_check" CHECK ("social_message_templates"."parameter_format" in ('positional', 'named'))
);
--> statement-breakpoint
ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_platform_check";--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "coexistence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "history_sync" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "history_progress" integer;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "participant_phone" text;--> statement-breakpoint
ALTER TABLE "social_messages" ADD COLUMN "template" jsonb;--> statement-breakpoint
ALTER TABLE "social_message_templates" ADD CONSTRAINT "social_message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_message_templates" ADD CONSTRAINT "social_message_templates_account_fkey" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."social_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_message_templates_account_idx" ON "social_message_templates" USING btree ("tenant_id","account_id","name");--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_history_sync_check" CHECK ("social_accounts"."history_sync" in ('requested', 'in_progress', 'complete', 'declined', 'failed'));--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_history_progress_check" CHECK ("social_accounts"."history_progress" between 0 and 100);--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_check" CHECK ("social_accounts"."platform" in ('facebook', 'instagram', 'tiktok', 'whatsapp'));--> statement-breakpoint
-- WhatsApp in the social inbox (ADR-066). Message templates belong to the business, behind the
-- same `social` feature switch as the rest of the inbox.
alter table "social_message_templates" enable row level security;
--> statement-breakpoint
grant select, insert, delete on "social_message_templates" to authenticated;
--> statement-breakpoint
grant update (name, language, category, status, parameter_format, body, header_text, footer_text,
              parameters, sendable, reason, synced_at, updated_at)
  on "social_message_templates" to authenticated;
--> statement-breakpoint
-- Anyone who reads the inbox may see the approved templates (to send one, social.reply is also
-- checked by the service); writing, refreshing and deleting them needs social.manage.
create policy social_message_templates_read on "social_message_templates" for select
  to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.view'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.manage')))
  );
--> statement-breakpoint
create policy social_message_templates_insert on "social_message_templates" for insert
  to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.manage'))
  );
--> statement-breakpoint
create policy social_message_templates_update on "social_message_templates" for update
  to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.manage'))
  );
--> statement-breakpoint
create policy social_message_templates_delete on "social_message_templates" for delete
  to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.manage'))
  );
--> statement-breakpoint
create policy feature_switch on "social_message_templates" as restrictive for all
  to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'social')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'social')));
--> statement-breakpoint
-- Connecting (or reconnecting) a WhatsApp number records whether it is also used in the WhatsApp
-- Business app, and the history import that follows; a conversation keeps the customer's number.
grant update (coexistence, history_sync, history_progress) on "social_accounts" to authenticated;
--> statement-breakpoint
grant update (participant_phone) on "social_conversations" to authenticated;
--> statement-breakpoint
-- Erasing a person on request (ADR-051, ADR-065) also forgets their phone number. On WhatsApp
-- the number is also the customer's id in the conversation, so that is replaced too: if they
-- write again, a new conversation starts with no link to the erased one.
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
  update public.social_conversations c
  set participant_name = 'Erased', participant_username = null, participant_avatar_path = null,
      last_message_preview = null, participant_phone = null,
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
