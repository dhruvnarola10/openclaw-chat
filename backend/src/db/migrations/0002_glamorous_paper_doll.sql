CREATE TABLE IF NOT EXISTS "approval_task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_id" uuid NOT NULL,
	"task_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"ui_visibility" text DEFAULT 'always' NOT NULL,
	"validation_regex" text,
	"description" text,
	"required" boolean DEFAULT false NOT NULL,
	"default_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'inbox';--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "rubric_scores" jsonb;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "lead_reasoning" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "board_type" text DEFAULT 'goal' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "success_metrics" jsonb;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "target_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "goal_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "require_approval_for_done" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "require_review_before_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "comment_required_for_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "block_status_with_pending_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "only_lead_can_change_status" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "max_agents" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "in_progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "previous_in_progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "auto_created" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "auto_reason" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "custom_field_values" jsonb;--> statement-breakpoint
ALTER TABLE "virtual_agents" ADD COLUMN "is_board_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_agents" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_task_links" ADD CONSTRAINT "approval_task_links_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_task_links" ADD CONSTRAINT "approval_task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_links_approval_idx" ON "approval_task_links" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_links_task_idx" ON "approval_task_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cfd_org_idx" ON "custom_field_definitions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cfd_org_key_idx" ON "custom_field_definitions" USING btree ("org_id","field_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_deps_task_idx" ON "task_dependencies" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_deps_uniq_idx" ON "task_dependencies" USING btree ("task_id","depends_on_task_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_board_idx" ON "approvals" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_priority_idx" ON "tasks" USING btree ("priority");