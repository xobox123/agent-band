ALTER TABLE "projects" ADD COLUMN "reviewer_target" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "auto_merge_on_approve" boolean DEFAULT false NOT NULL;