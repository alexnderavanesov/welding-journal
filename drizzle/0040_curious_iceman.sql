ALTER TABLE "dispatcher_accepted_warnings" ADD COLUMN "weld_joint_id" integer;--> statement-breakpoint
ALTER TABLE "dispatcher_accepted_warnings" ADD COLUMN "line_program_id" integer;--> statement-breakpoint
ALTER TABLE "dispatcher_accepted_warnings" ADD COLUMN "welder_stamp_id" integer;--> statement-breakpoint
ALTER TABLE "dispatcher_accepted_warnings" ADD CONSTRAINT "dispatcher_accepted_warnings_weld_joint_id_weld_joints_id_fk" FOREIGN KEY ("weld_joint_id") REFERENCES "public"."weld_joints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_accepted_warnings" ADD CONSTRAINT "dispatcher_accepted_warnings_line_program_id_line_programs_id_fk" FOREIGN KEY ("line_program_id") REFERENCES "public"."line_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_accepted_warnings" ADD CONSTRAINT "dispatcher_accepted_warnings_welder_stamp_id_welder_stamps_id_fk" FOREIGN KEY ("welder_stamp_id") REFERENCES "public"."welder_stamps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accepted_warnings_joint_idx" ON "dispatcher_accepted_warnings" USING btree ("weld_joint_id");--> statement-breakpoint
CREATE INDEX "accepted_warnings_line_idx" ON "dispatcher_accepted_warnings" USING btree ("line_program_id");--> statement-breakpoint
CREATE INDEX "accepted_warnings_stamp_idx" ON "dispatcher_accepted_warnings" USING btree ("welder_stamp_id");--> statement-breakpoint
CREATE INDEX "accepted_warnings_date_idx" ON "dispatcher_accepted_warnings" USING btree ("accepted_at","key");