CREATE TABLE "run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"effective_policy" jsonb NOT NULL,
	"skills" jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"exit_code" integer,
	"input_tokens" double precision DEFAULT 0 NOT NULL,
	"output_tokens" double precision DEFAULT 0 NOT NULL,
	"cached_tokens" double precision DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"rate_limit_resets_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "task_key_seq" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"work_dir" text NOT NULL,
	"target" jsonb NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"rank" double precision DEFAULT 0 NOT NULL,
	"mode" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"worker_id" text,
	"error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_priority" CHECK ("tasks"."priority" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "usage_account_blocks" (
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "usage_account_blocks_org_id_account_id_pk" PRIMARY KEY("org_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"window" text NOT NULL,
	"used_percent" double precision NOT NULL,
	"resets_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "run_events_org_run_id" ON "run_events" USING btree ("org_id","run_id","id");--> statement-breakpoint
CREATE INDEX "runs_org_account_status" ON "runs" USING btree ("org_id","account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_org_task" ON "runs" USING btree ("org_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_org_key" ON "tasks" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "tasks_queue" ON "tasks" USING btree ("org_id","status","priority","rank","created_at");--> statement-breakpoint
CREATE INDEX "usage_snapshots_account" ON "usage_snapshots" USING btree ("org_id","account_id","window","id");