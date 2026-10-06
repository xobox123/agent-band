CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"current_version" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_org_name_uq" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"org_id" uuid NOT NULL,
	"rules" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_policy_id_version_pk" PRIMARY KEY("policy_id","version")
);
--> statement-breakpoint
CREATE TABLE "skill_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"pinned_version" integer,
	"scope_kind" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_assignments_scope_uq" UNIQUE("skill_id","scope_kind","scope_id")
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"org_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"bundle" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"origin" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_skill_id_version_pk" PRIMARY KEY("skill_id","version")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"current_version" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_org_name_uq" UNIQUE("org_id","name")
);
--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assignments" ADD CONSTRAINT "skill_assignments_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_assignments_org_scope_idx" ON "skill_assignments" USING btree ("org_id","scope_kind","scope_id");