ALTER TABLE "social_conversations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_conversations" ADD COLUMN "important" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "social_conversations_bin_idx" ON "social_conversations" USING btree ("tenant_id","deleted_at") WHERE "social_conversations"."deleted_at" is not null;