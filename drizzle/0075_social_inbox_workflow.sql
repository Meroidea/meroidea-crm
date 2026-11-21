ALTER TABLE "social_conversations" DROP CONSTRAINT "social_conversations_status_check";--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_assignee_fkey" FOREIGN KEY ("tenant_id","assigned_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_conversations_assignee_idx" ON "social_conversations" USING btree ("tenant_id","assigned_user_id");--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_snooze_check" CHECK (("social_conversations"."status" = 'snoozed') = ("social_conversations"."snoozed_until" is not null));--> statement-breakpoint
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_status_check" CHECK ("social_conversations"."status" in ('open', 'snoozed', 'done'));--> statement-breakpoint
-- Inbox workflow (ADR-067): a colleague looks after a conversation, it can be snoozed, and the
-- inbox can be searched. Assigning and snoozing are changes to the conversation, made by people
-- who can reply (row-level security on social_conversations already requires social.view).
grant update (assigned_user_id, snoozed_until) on "social_conversations" to authenticated;
--> statement-breakpoint
-- Search by the customer's name, handle or number, and by what was said. Trigram indexes, as for
-- contacts (0005), so a part of a word or number is found.
create index if not exists social_conversations_search_idx on "social_conversations"
  using gin ((coalesce(participant_name, '') || ' ' || coalesce(participant_username, '') || ' '
             || coalesce(participant_phone, '')) extensions.gin_trgm_ops);
--> statement-breakpoint
create index if not exists social_messages_body_search_idx on "social_messages"
  using gin (body extensions.gin_trgm_ops);
