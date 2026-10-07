ALTER TABLE "accounts" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "workspace_root" text;--> statement-breakpoint
ALTER TABLE "goal_states" ADD COLUMN "approval" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "proposed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "start_after_reset" boolean DEFAULT false NOT NULL;