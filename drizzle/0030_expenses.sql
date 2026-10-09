CREATE TABLE "expense_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"category" text NOT NULL,
	"merchant" text,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"receipt_path" text,
	"receipt_name" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"reimbursed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_claims_person_idx" ON "expense_claims" USING btree ("tenant_id","user_id","spent_on") WHERE "expense_claims"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "expense_claims_status_idx" ON "expense_claims" USING btree ("tenant_id","status") WHERE "expense_claims"."deleted_at" is null;