CREATE TABLE "website_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text NOT NULL,
	"business_type" text,
	"team_size" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_enquiries_status_check" CHECK ("website_enquiries"."status" in ('new', 'contacted', 'closed'))
);
--> statement-breakpoint
CREATE INDEX "website_enquiries_created_idx" ON "website_enquiries" USING btree ("created_at");--> statement-breakpoint
-- Platform data, read and written only by the server's privileged connection on behalf of the
-- public form and platform owners. RLS on with no policies, and no grants, so neither the public
-- API nor a signed-in business user can read or write it, even where default privileges expose
-- new tables.
ALTER TABLE "website_enquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "website_enquiries" FROM anon, authenticated;
