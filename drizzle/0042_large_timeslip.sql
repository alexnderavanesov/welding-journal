CREATE TABLE "coil_restoration_events" (
	"token" text PRIMARY KEY NOT NULL,
	"source_weld_joint_id" integer NOT NULL,
	"confirmed_by" text NOT NULL,
	"snapshot" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weld_joint_program_states" DROP CONSTRAINT "weld_joint_program_states_weld_joint_id_weld_joints_id_fk";
--> statement-breakpoint
CREATE INDEX "coil_restoration_events_source_idx" ON "coil_restoration_events" USING btree ("source_weld_joint_id");--> statement-breakpoint
CREATE INDEX "weld_joint_program_states_source_idx" ON "weld_joint_program_states" USING btree ("source_row_id");