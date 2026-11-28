CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_drafts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "email_drafts_subject_check" CHECK (char_length("email_drafts"."subject") <= 200),
	CONSTRAINT "email_drafts_content_check" CHECK (octet_length("email_drafts"."content"::text) <= 1000000)
);
--> statement-breakpoint
CREATE TABLE "email_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"doc" jsonb NOT NULL,
	"use_on_new" boolean DEFAULT true NOT NULL,
	"use_on_replies" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_signatures_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "email_signatures_user_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "email_signatures_doc_check" CHECK (octet_length("email_signatures"."doc"::text) <= 200000)
);
--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_user_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_account_fkey" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."social_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_signatures" ADD CONSTRAINT "email_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_signatures" ADD CONSTRAINT "email_signatures_user_fkey" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_drafts_user_idx" ON "email_drafts" USING btree ("tenant_id","user_id","updated_at");
--> statement-breakpoint
-- Drafts and signatures (ADR-091) belong to one person: only they read, write or delete their
-- own, with social.reply, while the email feature is on. Nobody else in the business sees them.
alter table "email_drafts" enable row level security;
--> statement-breakpoint
alter table "email_signatures" enable row level security;
--> statement-breakpoint
grant select, insert, update, delete on "email_drafts" to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on "email_signatures" to authenticated;
--> statement-breakpoint
create policy email_drafts_own on "email_drafts" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select auth.uid())
    and (select app.has_permission((select app.active_tenant_id()), 'social.reply'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select auth.uid())
    and (select app.has_permission((select app.active_tenant_id()), 'social.reply'))
  );
--> statement-breakpoint
create policy email_signatures_own on "email_signatures" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select auth.uid())
    and (select app.has_permission((select app.active_tenant_id()), 'social.reply'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and user_id = (select auth.uid())
    and (select app.has_permission((select app.active_tenant_id()), 'social.reply'))
  );
--> statement-breakpoint
create policy feature_switch on "email_drafts" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'email_channel')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'email_channel')));
--> statement-breakpoint
create policy feature_switch on "email_signatures" as restrictive for all to authenticated
  using ((select app.feature_enabled((select app.active_tenant_id()), 'email_channel')))
  with check ((select app.feature_enabled((select app.active_tenant_id()), 'email_channel')));
--> statement-breakpoint
-- A draft's inbox must still be live and the email channel's own (the inbox_channel rule).
create policy inbox_channel on "email_drafts" as restrictive for all to authenticated
  using ((select app.inbox_account_enabled(account_id)))
  with check ((select app.inbox_account_enabled(account_id)));

