CREATE TABLE "goal_states" (
	"root_task_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"leader_agent_id" uuid,
	"leader_session_id" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"tree_tokens_used" double precision DEFAULT 0 NOT NULL,
	"limits" jsonb NOT NULL,
	"goal_prompt" text NOT NULL,
	"summary" text,
	"outcome" text,
	"reason" text,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "runs_org_task";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "root_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "depends_on" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "eligibility" jsonb;--> statement-breakpoint
CREATE INDEX "goal_states_org_status" ON "goal_states" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "tasks_root" ON "tasks" USING btree ("org_id","root_task_id");--> statement-breakpoint
CREATE INDEX "runs_org_task" ON "runs" USING btree ("org_id","task_id");