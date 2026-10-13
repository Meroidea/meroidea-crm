ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."roster_shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
