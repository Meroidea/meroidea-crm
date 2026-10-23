CREATE TABLE "platform_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"business_id" uuid,
	"business_name" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_audit_logs_created_idx" ON "platform_audit_logs" USING btree ("created_at");--> statement-breakpoint
-- Platform data, read and written only by the server's privileged connection on behalf of
-- platform owners. RLS on with no policies, and no grants, so neither the public API nor a
-- signed-in business user can read or write it.
ALTER TABLE "platform_audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "platform_audit_logs" FROM anon, authenticated;
