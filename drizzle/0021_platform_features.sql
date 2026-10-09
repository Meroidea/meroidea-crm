ALTER TABLE "tenant_memberships" ADD COLUMN "is_support" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "features" text[] DEFAULT '{}'::text[] NOT NULL;