ALTER TABLE "virtual_agents" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "virtual_agents" ADD COLUMN "role" text DEFAULT 'Generalist' NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_agents" ADD COLUMN "emoji" text DEFAULT '⚙️' NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_agents" ADD COLUMN "communication_style" text DEFAULT 'direct, concise, practical' NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_agents" ADD COLUMN "heartbeat_interval" text DEFAULT '10m' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "virtual_agents" ADD CONSTRAINT "virtual_agents_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "virtual_agents_board_idx" ON "virtual_agents" USING btree ("board_id");