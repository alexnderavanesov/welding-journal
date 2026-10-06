CREATE TABLE "weld_joint_program_states" (
	"weld_joint_id" integer PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"physical_root_id" integer,
	"source_row_id" integer,
	"coil_parent_id" integer,
	"coil_side" integer,
	"replaced_by_coil" boolean DEFAULT false NOT NULL,
	CONSTRAINT "weld_joint_program_states_kind_check" CHECK ("weld_joint_program_states"."kind" in ('primary', 'repair', 'coil')),
	CONSTRAINT "weld_joint_program_states_side_check" CHECK ("weld_joint_program_states"."coil_side" in (1, 2))
);
--> statement-breakpoint
ALTER TABLE "weld_joint_program_states" ADD CONSTRAINT "weld_joint_program_states_weld_joint_id_weld_joints_id_fk" FOREIGN KEY ("weld_joint_id") REFERENCES "public"."weld_joints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weld_joint_program_states_root_idx" ON "weld_joint_program_states" USING btree ("physical_root_id");--> statement-breakpoint
CREATE INDEX "weld_joint_program_states_coil_idx" ON "weld_joint_program_states" USING btree ("coil_parent_id");