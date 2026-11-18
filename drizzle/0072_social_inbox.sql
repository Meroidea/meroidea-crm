CREATE TABLE "social_account_credentials" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"access_expires_at" timestamp with time zone,
	"refresh_token_ciphertext" text,
	"refresh_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"avatar_url" text,
	"provider_business_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "social_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text,
	"participant_id" text NOT NULL,
	"participant_name" text,
	"participant_username" text,
	"contact_id" uuid,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"last_inbound_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_conversations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "social_conversations_participant_key" UNIQUE("account_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "social_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text,
	"direction" text NOT NULL,
	"body" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"sent_by_user_id" uuid,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_messages_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "social_account_credentials" ADD CONSTRAINT "social_account_credentials_account_fkey" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."social_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_account_fkey" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."social_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_contact_fkey" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."social_conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_account_fkey" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."social_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_live_key" ON "social_accounts" USING btree ("platform","external_id") WHERE "social_accounts"."disconnected_at" is null;--> statement-breakpoint
CREATE INDEX "social_accounts_tenant_idx" ON "social_accounts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "social_conversations_inbox_idx" ON "social_conversations" USING btree ("tenant_id","last_message_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_messages_external_key" ON "social_messages" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "social_messages_thread_idx" ON "social_messages" USING btree ("tenant_id","conversation_id","sent_at");--> statement-breakpoint

-- Social inbox (ADR-064). Every table is the business's own, behind the `social` feature switch.
alter table "social_accounts" enable row level security;
--> statement-breakpoint
alter table "social_account_credentials" enable row level security;
--> statement-breakpoint
alter table "social_conversations" enable row level security;
--> statement-breakpoint
alter table "social_messages" enable row level security;
--> statement-breakpoint

-- Access tokens: no session reads or writes them; only the app.social_* functions below (with a
-- permission check) and verified webhooks through the privileged connection. A manager of the
-- business's accounts may see which accounts hold tokens and when they changed, never the
-- sealed values themselves (column grants, as for tenant_agreements' token_hash).
revoke all on "social_account_credentials" from anon, authenticated;
--> statement-breakpoint
grant select (account_id, tenant_id, access_expires_at, refresh_expires_at, updated_at)
  on "social_account_credentials" to authenticated;
--> statement-breakpoint
create policy social_account_credentials_read on "social_account_credentials" for select
  to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.manage'))
  );
--> statement-breakpoint

grant select, insert on "social_accounts" to authenticated;
--> statement-breakpoint
grant update (name, username, avatar_url, provider_business_id, status, last_error,
              disconnected_at, last_synced_at, updated_at) on "social_accounts" to authenticated;
--> statement-breakpoint
grant select, insert on "social_conversations" to authenticated;
--> statement-breakpoint
grant update (external_id, participant_name, participant_username, contact_id, last_message_at,
              last_message_preview, last_inbound_at, unread_count, status, updated_at)
  on "social_conversations" to authenticated;
--> statement-breakpoint
grant select, insert on "social_messages" to authenticated;
--> statement-breakpoint
grant update (external_id, status, error) on "social_messages" to authenticated;
--> statement-breakpoint

-- Reading needs social.view (or social.manage, to see what is connected). Connecting an account
-- needs social.manage. Replying (an outbound message, the conversation's last message) needs
-- social.reply; the first import of a newly connected account's history needs social.manage.
create policy social_accounts_read on "social_accounts" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.view'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.manage')))
  );
--> statement-breakpoint
create policy social_accounts_insert on "social_accounts" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.manage'))
  );
--> statement-breakpoint
create policy social_accounts_update on "social_accounts" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.manage'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.reply')))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.manage'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.reply')))
  );
--> statement-breakpoint
create policy social_conversations_read on "social_conversations" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.view'))
  );
--> statement-breakpoint
create policy social_conversations_insert on "social_conversations" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.manage'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.reply')))
  );
--> statement-breakpoint
create policy social_conversations_update on "social_conversations" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.view'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.view'))
  );
--> statement-breakpoint
create policy social_messages_read on "social_messages" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'social.view'))
  );
--> statement-breakpoint
create policy social_messages_insert on "social_messages" for insert to authenticated
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.manage'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.reply')))
  );
--> statement-breakpoint
create policy social_messages_update on "social_messages" for update to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.manage'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.reply')))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.manage'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.reply')))
  );
--> statement-breakpoint

-- The feature switch (ADR-038): with `social` off for a business, nothing here is reachable.
do $$
declare t text;
begin
  foreach t in array array['social_accounts', 'social_account_credentials',
                           'social_conversations', 'social_messages'] loop
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'social', 'social'
    );
  end loop;
end $$;
--> statement-breakpoint

-- Store an account's sealed tokens. Connecting (no tokens yet) needs social.manage; replacing
-- tokens that already exist (a renewal while replying) also allows social.reply. The values are
-- ciphertext from the server's encryptField; the database never sees a token in the clear.
create or replace function app.social_store_credentials(
  p_account uuid,
  p_access text,
  p_access_expires timestamptz,
  p_refresh text,
  p_refresh_expires timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.active_tenant_id();
  v_exists boolean;
begin
  if v_tenant is null or not (v_tenant in (select app.tenant_ids())) then
    raise exception 'not a member of the active business' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.social_accounts a
    where a.id = p_account and a.tenant_id = v_tenant and a.disconnected_at is null
  ) then
    raise exception 'no such connected account' using errcode = '42501';
  end if;
  select exists (select 1 from public.social_account_credentials c where c.account_id = p_account)
    into v_exists;
  if not (app.has_permission(v_tenant, 'social.manage')
          or (v_exists and app.has_permission(v_tenant, 'social.reply'))) then
    raise exception 'not allowed to store these credentials' using errcode = '42501';
  end if;
  insert into public.social_account_credentials (account_id, tenant_id, access_token_ciphertext,
    access_expires_at, refresh_token_ciphertext, refresh_expires_at, updated_at)
  values (p_account, v_tenant, p_access, p_access_expires, p_refresh, p_refresh_expires, now())
  on conflict (account_id) do update set
    access_token_ciphertext = excluded.access_token_ciphertext,
    access_expires_at = excluded.access_expires_at,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    refresh_expires_at = excluded.refresh_expires_at,
    updated_at = now();
end $$;
--> statement-breakpoint

-- The sealed tokens, for replying (social.reply) or managing (social.manage) a live account.
create or replace function app.social_read_credentials(p_account uuid)
returns table (access_token_ciphertext text, access_expires_at timestamptz,
               refresh_token_ciphertext text, refresh_expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.access_token_ciphertext, c.access_expires_at, c.refresh_token_ciphertext,
         c.refresh_expires_at
  from public.social_account_credentials c
  join public.social_accounts a on a.tenant_id = c.tenant_id and a.id = c.account_id
  where c.account_id = p_account
    and c.tenant_id = (select app.active_tenant_id())
    and c.tenant_id in (select app.tenant_ids())
    and a.disconnected_at is null
    and ((select app.has_permission((select app.active_tenant_id()), 'social.reply'))
         or (select app.has_permission((select app.active_tenant_id()), 'social.manage')));
$$;
--> statement-breakpoint

-- Forget an account's tokens when it is disconnected (social.manage).
create or replace function app.social_clear_credentials(p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := app.active_tenant_id();
begin
  if v_tenant is null or not (v_tenant in (select app.tenant_ids()))
     or not app.has_permission(v_tenant, 'social.manage') then
    raise exception 'not allowed to clear these credentials' using errcode = '42501';
  end if;
  delete from public.social_account_credentials c
  where c.account_id = p_account and c.tenant_id = v_tenant;
end $$;
--> statement-breakpoint

revoke execute on function app.social_store_credentials(uuid, text, timestamptz, text, timestamptz),
  app.social_read_credentials(uuid), app.social_clear_credentials(uuid) from public;
--> statement-breakpoint
grant execute on function app.social_store_credentials(uuid, text, timestamptz, text, timestamptz),
  app.social_read_credentials(uuid), app.social_clear_credentials(uuid) to authenticated;
--> statement-breakpoint

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
    when 'social' then 'social'
    else null
  end;
$$;
--> statement-breakpoint

-- Existing businesses' Admin role gets what a new business's does. The inbox stays off until the
-- platform owner switches the feature on for a business (ADR-029).
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('social.view'), ('social.reply'), ('social.manage')) as p(permission)
where r.key = 'owner'
on conflict (role_id, permission) do nothing;
