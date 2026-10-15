ALTER TABLE "web_forms" ADD COLUMN "fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "web_forms" ADD COLUMN "heading" text;--> statement-breakpoint
ALTER TABLE "web_forms" ADD COLUMN "intro" text;--> statement-breakpoint
ALTER TABLE "web_forms" ADD COLUMN "submit_label" text;--> statement-breakpoint
ALTER TABLE "web_forms" ADD COLUMN "published_at" timestamp with time zone;