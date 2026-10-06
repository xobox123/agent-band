CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cron" text NOT NULL,
	"timezone" text,
	"template" jsonb NOT NULL,
	"overlap" text DEFAULT 'skip' NOT NULL,
	"last_fired_at" timestamp with time zone,
	"last_task_id" uuid,
	"next_fire_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "resume_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "schedules_due" ON "schedules" USING btree ("enabled","next_fire_at");--> statement-breakpoint
CREATE INDEX "schedules_org" ON "schedules" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "tasks_run_at" ON "tasks" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "tasks_resume_at" ON "tasks" USING btree ("status","resume_at");--> statement-breakpoint
CREATE INDEX "tasks_schedule" ON "tasks" USING btree ("org_id","schedule_id");