CREATE TABLE "public_rate_limits" (
	"bucket" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "public_rate_limits_bucket_subject_hash_window_start_pk" PRIMARY KEY("bucket","subject_hash","window_start")
);
--> statement-breakpoint
CREATE INDEX "public_rate_limits_window_idx" ON "public_rate_limits" USING btree ("window_start");--> statement-breakpoint
-- Only the server's privileged connection uses this table (ADR-039). RLS on with no policies,
-- and no grants, so neither the public API nor a signed-in user can read or write it, even on
-- a project whose default privileges expose new tables.
ALTER TABLE "public_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "public_rate_limits" FROM anon, authenticated;
