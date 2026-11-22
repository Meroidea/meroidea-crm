CREATE TABLE "kb_article_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"helpful" boolean NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_article_feedback_comment_check" CHECK (char_length(coalesce("kb_article_feedback"."comment", '')) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "kb_article_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" text NOT NULL,
	"conversation_id" uuid,
	"ticket_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "kb_article_links_source_check" CHECK ("kb_article_links"."source" in ('inbox', 'ticket'))
);
--> statement-breakpoint
CREATE TABLE "kb_article_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"source" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"body_markdown" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_markdown, ''))) STORED,
	"view_count" integer DEFAULT 0 NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"not_helpful_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "kb_articles_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "kb_articles_status_check" CHECK ("kb_articles"."status" in ('draft', 'published')),
	CONSTRAINT "kb_articles_slug_check" CHECK ("kb_articles"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,118}[a-z0-9])?$'),
	CONSTRAINT "kb_articles_size_check" CHECK (char_length("kb_articles"."title") between 1 and 200 and char_length("kb_articles"."body_markdown") <= 100000 and char_length(coalesce("kb_articles"."summary", '')) <= 300)
);
--> statement-breakpoint
CREATE TABLE "kb_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "kb_categories_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "kb_categories_slug_check" CHECK ("kb_categories"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$')
);
--> statement-breakpoint
CREATE TABLE "kb_portals" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"title" text,
	"intro" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "kb_article_feedback" ADD CONSTRAINT "kb_article_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_feedback" ADD CONSTRAINT "kb_article_feedback_article_fkey" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."kb_articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_links" ADD CONSTRAINT "kb_article_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_links" ADD CONSTRAINT "kb_article_links_article_fkey" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."kb_articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_links" ADD CONSTRAINT "kb_article_links_contact_fkey" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_links" ADD CONSTRAINT "kb_article_links_conversation_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."social_conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_links" ADD CONSTRAINT "kb_article_links_ticket_fkey" FOREIGN KEY ("tenant_id","ticket_id") REFERENCES "public"."tickets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_views" ADD CONSTRAINT "kb_article_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_views" ADD CONSTRAINT "kb_article_views_article_fkey" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."kb_articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_views" ADD CONSTRAINT "kb_article_views_contact_fkey" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_views" ADD CONSTRAINT "kb_article_views_link_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."kb_article_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_category_fkey" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."kb_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_portals" ADD CONSTRAINT "kb_portals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_article_feedback_article_idx" ON "kb_article_feedback" USING btree ("tenant_id","article_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_article_links_token_key" ON "kb_article_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "kb_article_views_contact_idx" ON "kb_article_views" USING btree ("tenant_id","contact_id","viewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_articles_slug_key" ON "kb_articles" USING btree ("tenant_id","slug") WHERE "kb_articles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "kb_articles_list_idx" ON "kb_articles" USING btree ("tenant_id","status","updated_at") WHERE "kb_articles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "kb_articles_search_idx" ON "kb_articles" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_categories_slug_key" ON "kb_categories" USING btree ("tenant_id","slug") WHERE "kb_categories"."deleted_at" is null;--> statement-breakpoint

-- Knowledge base (ADR-071): a public help portal per business, articles in Markdown, and which
-- known contacts read the articles sent to them. Public reads and feedback are written only by
-- src/modules/kb/public.ts (privileged, starting from the business's slug).

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
    when 'kb' then 'knowledge_base'
    else null
  end;
$$;
--> statement-breakpoint
alter table "kb_portals" enable row level security;
--> statement-breakpoint
alter table "kb_categories" enable row level security;
--> statement-breakpoint
alter table "kb_articles" enable row level security;
--> statement-breakpoint
alter table "kb_article_feedback" enable row level security;
--> statement-breakpoint
alter table "kb_article_links" enable row level security;
--> statement-breakpoint
alter table "kb_article_views" enable row level security;
--> statement-breakpoint
grant select, insert, update on "kb_portals" to authenticated;
--> statement-breakpoint
grant select, insert, update on "kb_categories", "kb_articles" to authenticated;
--> statement-breakpoint
grant select on "kb_article_feedback", "kb_article_views" to authenticated;
--> statement-breakpoint
grant select, insert on "kb_article_links" to authenticated;
--> statement-breakpoint
-- The view counters and feedback tallies are the public module's; editors never write them.
revoke update on "kb_articles" from authenticated;
--> statement-breakpoint
grant update (category_id, title, slug, summary, body_markdown, status, published_at, updated_at,
  updated_by, deleted_at) on "kb_articles" to authenticated;
--> statement-breakpoint

-- The portal's settings are written with kb.manage. Whether it is open is read by anyone who
-- answers customers too, so nobody sends a link to a closed portal.
create policy kb_portals_read on "kb_portals" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and ((select app.has_permission((select app.active_tenant_id()), 'kb.manage')) or (select app.has_permission((select app.active_tenant_id()), 'social.reply')) or (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))));
--> statement-breakpoint
create policy kb_portals_manage on "kb_portals" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (select app.has_permission((select app.active_tenant_id()), 'kb.manage')))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (select app.has_permission((select app.active_tenant_id()), 'kb.manage')));
--> statement-breakpoint
create policy kb_categories_read on "kb_categories" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and ((select app.has_permission((select app.active_tenant_id()), 'kb.manage')) or (select app.has_permission((select app.active_tenant_id()), 'social.reply')) or (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))));
--> statement-breakpoint
create policy kb_categories_write on "kb_categories" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (select app.has_permission((select app.active_tenant_id()), 'kb.manage')))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (select app.has_permission((select app.active_tenant_id()), 'kb.manage')));
--> statement-breakpoint
-- Editors see every article; people who answer customers (inbox or helpdesk) see published ones,
-- to send links to.
create policy kb_articles_read on "kb_articles" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and ((select app.has_permission((select app.active_tenant_id()), 'kb.manage'))
    or (((select app.has_permission((select app.active_tenant_id()), 'social.reply')) or (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))) and status = 'published' and deleted_at is null)));
--> statement-breakpoint
create policy kb_articles_write on "kb_articles" for all to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (select app.has_permission((select app.active_tenant_id()), 'kb.manage')))
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (select app.has_permission((select app.active_tenant_id()), 'kb.manage')));
--> statement-breakpoint
create policy kb_article_feedback_read on "kb_article_feedback" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (select app.has_permission((select app.active_tenant_id()), 'kb.manage')));
--> statement-breakpoint
-- A link is made by the person sending it, in their own name, for a reply they may write.
create policy kb_article_links_insert on "kb_article_links" for insert to authenticated
  with check (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and created_by = (select auth.uid())
    and ((select app.has_permission((select app.active_tenant_id()), 'social.reply')) or (select app.has_permission((select app.active_tenant_id()), 'tickets.work'))));
--> statement-breakpoint
create policy kb_article_links_read on "kb_article_links" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and (created_by = (select auth.uid()) or (select app.has_permission((select app.active_tenant_id()), 'kb.manage'))));
--> statement-breakpoint
-- What a contact read shows on their timeline and their tickets.
create policy kb_article_views_read on "kb_article_views" for select to authenticated
  using (tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids()) and ((select app.has_permission((select app.active_tenant_id()), 'contacts.view')) or (select app.has_permission((select app.active_tenant_id()), 'tickets.work')) or (select app.has_permission((select app.active_tenant_id()), 'social.view'))));
--> statement-breakpoint
do $$
declare t text;
begin
  foreach t in array array['kb_portals', 'kb_categories', 'kb_articles', 'kb_article_feedback',
                           'kb_article_links', 'kb_article_views'] loop
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'knowledge_base', 'knowledge_base');
  end loop;
end $$;
--> statement-breakpoint

-- Every Admin and Manager can write the knowledge base, as new businesses' roles do.
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'kb.manage', null
from public.roles r where r.key in ('owner', 'manager')
on conflict (role_id, permission) do nothing;
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
