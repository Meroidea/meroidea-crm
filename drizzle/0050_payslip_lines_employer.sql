ALTER TABLE "payslips" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "employer" jsonb;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "employment_type" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "classification" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;