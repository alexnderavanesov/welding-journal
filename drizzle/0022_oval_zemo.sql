ALTER TABLE "dispatcher_accepted_warnings" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "dispatcher_accepted_warnings" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "dispatcher_task_index_state" ADD COLUMN "dirty_scopes" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatcher_task_index_state" ADD COLUMN "full_rebuild" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD COLUMN "source_metadata" text;--> statement-breakpoint
CREATE INDEX "generated_documents_type_period_title_idx" ON "generated_documents" USING btree ("type","period_from","title");