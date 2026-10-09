ALTER TABLE "tenants" ADD COLUMN "location_latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "location_longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "clock_radius_metres" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "clock_in_distance_m" integer;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "clock_out_distance_m" integer;