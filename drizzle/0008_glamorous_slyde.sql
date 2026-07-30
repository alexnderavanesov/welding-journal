CREATE INDEX "weld_joints_weld_date_idx" ON "weld_joints" USING btree ("weld_date");--> statement-breakpoint
CREATE INDEX "weld_joints_project_title_idx" ON "weld_joints" USING btree ("project_title");--> statement-breakpoint
CREATE INDEX "weld_joints_subtitle_code_idx" ON "weld_joints" USING btree ("subtitle_code");--> statement-breakpoint
CREATE INDEX "weld_joints_line_idx" ON "weld_joints" USING btree ("line");--> statement-breakpoint
CREATE INDEX "weld_joints_joint_idx" ON "weld_joints" USING btree ("joint");--> statement-breakpoint
CREATE INDEX "weld_joints_final_status_idx" ON "weld_joints" USING btree ("final_status");--> statement-breakpoint
CREATE INDEX "weld_joints_psto_required_idx" ON "weld_joints" USING btree ("psto_required");--> statement-breakpoint
CREATE INDEX "weld_joints_line_joint_idx" ON "weld_joints" USING btree ("line","joint");