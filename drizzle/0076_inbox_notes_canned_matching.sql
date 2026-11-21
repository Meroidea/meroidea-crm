CREATE TABLE "social_canned_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"title" text NOT NULL,
	"shortcut" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "social_canned_responses_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "social_canned_responses_shortcut_check" CHECK ("social_canned_responses"."shortcut" ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
	CONSTRAINT "social_canned_responses_size_check" CHECK (char_length("social_canned_responses"."title") between 1 and 120 and char_length("social_canned_responses"."body") between 1 and 4096)
);
--> statement-breakpoint
ALTER TABLE "social_messages" DROP CONSTRAINT "social_messages_direction_check";--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "contact_match" text;--> statement-breakpoint
ALTER TABLE "social_canned_responses" ADD CONSTRAINT "social_canned_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_canned_responses" ADD CONSTRAINT "social_canned_responses_owner_fkey" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_canned_responses_shortcut_key" ON "social_canned_responses" USING btree ("tenant_id",coalesce("owner_user_id", '00000000-0000-0000-0000-000000000000'::uuid),"shortcut") WHERE "social_canned_responses"."shortcut" is not null;--> statement-breakpoint
CREATE INDEX "social_canned_responses_list_idx" ON "social_canned_responses" USING btree ("tenant_id","owner_user_id","title");--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_contact_match_check" CHECK ("social_conversations"."contact_match" in ('auto', 'created', 'suggested', 'manual'));--> statement-breakpoint
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_note_check" CHECK ("social_messages"."direction" <> 'note' or ("social_messages"."sent_by_user_id" is not null and "social_messages"."external_id" is null and "social_messages"."status" = 'sent' and "social_messages"."attachments" = '[]'::jsonb));--> statement-breakpoint
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_direction_check" CHECK ("social_messages"."direction" in ('inbound', 'outbound', 'note'));--> statement-breakpoint

-- Inbox foundations (ADR-068): private notes in a conversation, saved replies, finding the
-- sender's contact, and colleagues seeing who else is on a conversation.

-- Conversations already linked to a contact were linked by a person.
update "social_conversations" set contact_match = 'manual' where contact_id is not null;
--> statement-breakpoint
grant update (contact_match) on "social_conversations" to authenticated;
--> statement-breakpoint

-- A private note is written in its author's own name: nobody can leave one as a colleague.
-- (Notes are never updated: the body is not in the update grants on social_messages.)
create policy social_messages_note_author on "social_messages" as restrictive
  for insert to authenticated
  with check (direction <> 'note' or sent_by_user_id = (select auth.uid()));
--> statement-breakpoint

-- Saved replies. Reading needs social.reply (they are only of use in the reply box). A person's
-- own replies are theirs alone; shared ones are written with social.canned_manage.
alter table "social_canned_responses" enable row level security;
--> statement-breakpoint
grant select, insert, update, delete on "social_canned_responses" to authenticated;
--> statement-breakpoint
create policy social_canned_responses_read on "social_canned_responses" for select
  to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.reply'))
    and (owner_user_id is null or owner_user_id = (select auth.uid()))
  );
--> statement-breakpoint
create policy social_canned_responses_write on "social_canned_responses" for all
  to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (owner_user_id = (select auth.uid())
        and (select app.has_permission((select app.active_tenant_id()), 'social.reply')))
      or (owner_user_id is null
        and (select app.has_permission((select app.active_tenant_id()), 'social.canned_manage')))
    )
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (owner_user_id = (select auth.uid())
        and (select app.has_permission((select app.active_tenant_id()), 'social.reply')))
      or (owner_user_id is null
        and (select app.has_permission((select app.active_tenant_id()), 'social.canned_manage')))
    )
  );
--> statement-breakpoint
create policy feature_switch on "social_canned_responses" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'social')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'social')));
--> statement-breakpoint

-- An account's inbox settings. The update policy on social_accounts also lets social.reply
-- through (token renewals), so settings are not granted as a column: only this function, with
-- social.manage, writes them, and it accepts only the known keys.
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
                where k not in ('createLeadForUnknown', 'leadSourceId'))
     or (p_settings ? 'createLeadForUnknown'
         and jsonb_typeof(p_settings -> 'createLeadForUnknown') <> 'boolean')
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
revoke execute on function app.social_set_account_settings(uuid, jsonb) from public;
--> statement-breakpoint
grant execute on function app.social_set_account_settings(uuid, jsonb) to authenticated;
--> statement-breakpoint

-- Who is on which conversation (Realtime Presence, owner's approval 21 November 2026). Its own
-- private channel `social-presence:<tenant>`, joined with social.view while the business is
-- open. Presence carries only a person's id, the conversation's id and whether they are typing;
-- never anything a customer or colleague wrote.
create or replace function app.social_presence_allowed(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_topic ~ '^social-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then app.has_permission(substr(p_topic, 17)::uuid, 'social.view')
      and exists (
        select 1 from public.tenants t
        where t.id = substr(p_topic, 17)::uuid
          and t.status not in ('suspended', 'awaiting_agreement')
      )
    else false
  end;
$$;
--> statement-breakpoint
revoke execute on function app.social_presence_allowed(text) from public;
--> statement-breakpoint
grant execute on function app.social_presence_allowed(text) to authenticated;
--> statement-breakpoint
do $$
begin
  if to_regclass('realtime.messages') is not null then
    create policy social_presence_receive on "realtime"."messages" for select to authenticated
      using (
        "realtime"."messages"."extension" = 'presence'
        and (select app.social_presence_allowed((select realtime.topic())))
      );
    create policy social_presence_track on "realtime"."messages" for insert to authenticated
      with check (
        "realtime"."messages"."extension" = 'presence'
        and (select app.social_presence_allowed((select realtime.topic())))
      );
  end if;
end $$;
--> statement-breakpoint

-- The new permission: every Admin, and each Manager role that can already reply.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'social.canned_manage', null
from public.roles r
where r.key = 'owner'
   or (r.key = 'manager' and exists (
     select 1 from public.role_permissions rp
     where rp.role_id = r.id and rp.permission = 'social.reply'))
on conflict (role_id, permission) do nothing;
