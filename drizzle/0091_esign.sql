CREATE TABLE "sign_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"signer_id" uuid,
	"actor_user_id" uuid,
	"event" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_request_events_event_check" CHECK ("sign_request_events"."event" in ('created', 'sent', 'invited', 'code_sent', 'verified', 'viewed',
        'signed', 'declined', 'voided', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "sign_request_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"page" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"label" text,
	"value" text,
	"filled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_request_fields_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sign_request_fields_kind_check" CHECK ("sign_request_fields"."kind" in ('signature', 'initials', 'name', 'date', 'text', 'checkbox')),
	CONSTRAINT "sign_request_fields_page_check" CHECK ("sign_request_fields"."page" >= 1),
	CONSTRAINT "sign_request_fields_box_check" CHECK ("sign_request_fields"."x" >= 0 and "sign_request_fields"."y" >= 0 and "sign_request_fields"."width" > 0 and "sign_request_fields"."height" > 0
        and "sign_request_fields"."x" + "sign_request_fields"."width" <= 1.0001 and "sign_request_fields"."y" + "sign_request_fields"."height" <= 1.0001)
);
--> statement-breakpoint
CREATE TABLE "sign_request_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"session_hash" text,
	"verified_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_ip" "inet",
	"signed_user_agent" text,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_request_signers_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sign_request_signers_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sign_request_signers_position_key" UNIQUE("request_id","position"),
	CONSTRAINT "sign_request_signers_email_key" UNIQUE("request_id","email"),
	CONSTRAINT "sign_request_signers_status_check" CHECK ("sign_request_signers"."status" in ('pending', 'signed', 'declined')),
	CONSTRAINT "sign_request_signers_position_check" CHECK ("sign_request_signers"."position" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "sign_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version" integer NOT NULL,
	"original_storage_path" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"signing_order" text DEFAULT 'parallel' NOT NULL,
	"verify_email" boolean DEFAULT true NOT NULL,
	"expiry_days" integer,
	"expires_at" timestamp with time zone,
	"page_count" integer,
	"original_sha256" text,
	"signed_storage_path" text,
	"signed_sha256" text,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"completed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sign_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sign_requests_status_check" CHECK ("sign_requests"."status" in ('draft', 'sent', 'completed', 'declined', 'voided')),
	CONSTRAINT "sign_requests_signing_order_check" CHECK ("sign_requests"."signing_order" in ('parallel', 'sequential')),
	CONSTRAINT "sign_requests_expiry_days_check" CHECK ("sign_requests"."expiry_days" between 1 and 365),
	CONSTRAINT "sign_requests_sha256_check" CHECK ("sign_requests"."original_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sign_requests_signed_sha256_check" CHECK ("sign_requests"."signed_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sign_request_events" ADD CONSTRAINT "sign_request_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_request_events" ADD CONSTRAINT "sign_request_events_tenant_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."sign_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_request_events" ADD CONSTRAINT "sign_request_events_tenant_signer_fk" FOREIGN KEY ("tenant_id","signer_id") REFERENCES "public"."sign_request_signers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_request_fields" ADD CONSTRAINT "sign_request_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_request_fields" ADD CONSTRAINT "sign_request_fields_tenant_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."sign_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_request_fields" ADD CONSTRAINT "sign_request_fields_tenant_signer_fk" FOREIGN KEY ("tenant_id","signer_id") REFERENCES "public"."sign_request_signers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_request_signers" ADD CONSTRAINT "sign_request_signers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_request_signers" ADD CONSTRAINT "sign_request_signers_tenant_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."sign_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_requests" ADD CONSTRAINT "sign_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_requests" ADD CONSTRAINT "sign_requests_tenant_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."library_documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_requests" ADD CONSTRAINT "sign_requests_tenant_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_requests" ADD CONSTRAINT "sign_requests_tenant_sent_by_fk" FOREIGN KEY ("tenant_id","sent_by") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sign_request_events_request_idx" ON "sign_request_events" USING btree ("tenant_id","request_id","created_at");--> statement-breakpoint
CREATE INDEX "sign_request_fields_request_idx" ON "sign_request_fields" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE INDEX "sign_request_signers_request_idx" ON "sign_request_signers" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE INDEX "sign_requests_list_idx" ON "sign_requests" USING btree ("tenant_id","created_at" DESC NULLS LAST) WHERE "sign_requests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sign_requests_document_idx" ON "sign_requests" USING btree ("tenant_id","document_id") WHERE "sign_requests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sign_requests_signed_sha256_idx" ON "sign_requests" USING btree ("signed_sha256") WHERE "sign_requests"."signed_sha256" is not null;