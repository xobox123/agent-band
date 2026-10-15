ALTER TABLE "runs" ADD COLUMN "owner" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "process" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "process_reaped_at" timestamp with time zone;
