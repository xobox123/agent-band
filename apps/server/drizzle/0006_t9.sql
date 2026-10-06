CREATE TABLE "execution_run_auth" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"work_dir" text NOT NULL,
	"token_hash" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
