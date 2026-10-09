CREATE TABLE "customer_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"review_link_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"customer_name" text,
	"customer_email" text,
	"contact_allowed" boolean DEFAULT false NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"internal_note" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"public_token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "review_links_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "helpdesk_forms" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"public_token" text NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"subject" text NOT NULL,
	"requester_name" text NOT NULL,
	"requester_email" text,
	"contact_id" uuid,
	"category" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_user_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"public_token" text NOT NULL,
	"response_due_at" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"solved_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tickets_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tickets_tenant_number_key" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_link_fkey" FOREIGN KEY ("tenant_id","review_link_id") REFERENCES "public"."review_links"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_links" ADD CONSTRAINT "review_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_forms" ADD CONSTRAINT "helpdesk_forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_fkey" FOREIGN KEY ("tenant_id","ticket_id") REFERENCES "public"."tickets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_reviews_list_idx" ON "customer_reviews" USING btree ("tenant_id","created_at") WHERE "customer_reviews"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customer_reviews_status_idx" ON "customer_reviews" USING btree ("tenant_id","status") WHERE "customer_reviews"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "review_links_public_token_key" ON "review_links" USING btree ("public_token");--> statement-breakpoint
CREATE UNIQUE INDEX "helpdesk_forms_public_token_key" ON "helpdesk_forms" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "ticket_messages_thread_idx" ON "ticket_messages" USING btree ("tenant_id","ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_public_token_key" ON "tickets" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "tickets" USING btree ("tenant_id","status","last_activity_at") WHERE "tickets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("tenant_id","assignee_user_id","status") WHERE "tickets"."deleted_at" is null;