CREATE TABLE "line_programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_title" text DEFAULT '' NOT NULL,
	"subtitle_code" text DEFAULT '' NOT NULL,
	"line" text NOT NULL,
	"category" text,
	"group_name" text,
	"weld_control_percent" numeric(12, 3),
	"pvk_control_percent" numeric(12, 3),
	"configuration_issue" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_programs_line_required" CHECK (btrim("line_programs"."line") <> ''),
	CONSTRAINT "line_programs_percent_range" CHECK ("line_programs"."weld_control_percent" between 0 and 100),
	CONSTRAINT "line_programs_pvk_range" CHECK ("line_programs"."pvk_control_percent" between 0 and 100),
	CONSTRAINT "line_programs_pvk_limit" CHECK ("line_programs"."weld_control_percent" is null or "line_programs"."pvk_control_percent" is null or
    ("line_programs"."weld_control_percent" = 100 and "line_programs"."pvk_control_percent" >= 1) or
    ("line_programs"."weld_control_percent" < 100 and "line_programs"."pvk_control_percent" <= "line_programs"."weld_control_percent"))
);
--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "line_program_id" integer;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "pvk_control_percent" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "layered_control_assigned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "line_programs_identity_idx" ON "line_programs" USING btree (lower(btrim("project_title")),lower(btrim("subtitle_code")),lower(btrim("line")));--> statement-breakpoint
ALTER TABLE "weld_joints" ADD CONSTRAINT "weld_joints_line_program_id_line_programs_id_fk" FOREIGN KEY ("line_program_id") REFERENCES "public"."line_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weld_joints_line_program_idx" ON "weld_joints" USING btree ("line_program_id");