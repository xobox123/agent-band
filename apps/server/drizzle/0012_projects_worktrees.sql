CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"repo_path" text NOT NULL,
	"default_branch" text NOT NULL,
	"worktrees_root" text NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keep_worktrees" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "base_branch" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "review" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug" ON "projects" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "projects_org" ON "projects" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "tasks_project" ON "tasks" USING btree ("org_id","project_id");