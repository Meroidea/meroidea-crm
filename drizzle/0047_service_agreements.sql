ALTER TYPE "public"."tenant_status" ADD VALUE 'awaiting_agreement';--> statement-breakpoint
CREATE TABLE "service_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_agreements_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "tenant_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_name" text,
	"accepted_ip" text,
	"accepted_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_agreements_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "tenant_agreements_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "business_number" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "primary_contact_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "primary_contact_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "primary_contact_phone" text;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_agreement_id_service_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."service_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_agreements_one_open_key" ON "tenant_agreements" USING btree ("tenant_id") WHERE "tenant_agreements"."accepted_at" is null;--> statement-breakpoint
-- Service agreements (ADR-047). Both tables are written only by the server's privileged
-- connection: the platform console publishes versions and sends links, and the public accept
-- page records an acceptance from the link's secret. A business's admin (settings.manage) may
-- read their own acceptance and the wording they accepted, never the link's secret or the
-- network details recorded with it.
ALTER TABLE "service_agreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "service_agreements" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON "tenant_agreements" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "agreement_id", "recipient_name", "recipient_email", "sent_at",
  "accepted_at", "accepted_name") ON "tenant_agreements" TO authenticated;--> statement-breakpoint
GRANT SELECT ON "service_agreements" TO authenticated;--> statement-breakpoint
CREATE POLICY tenant_agreements_read ON "tenant_agreements" FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT app.tenant_ids())
    AND app.has_permission(tenant_id, 'settings.manage')
  );--> statement-breakpoint
CREATE POLICY service_agreements_read_accepted ON "service_agreements" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_agreements ta
      WHERE ta.agreement_id = service_agreements.id
        AND ta.accepted_at IS NOT NULL
    )
  );
