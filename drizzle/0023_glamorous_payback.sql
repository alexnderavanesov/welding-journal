CREATE TABLE "dispatcher_background_row_tasks" (
	"weld_joint_id" integer NOT NULL,
	"task_key" text NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "dispatcher_background_row_tasks_weld_joint_id_task_key_pk" PRIMARY KEY("weld_joint_id","task_key")
);
--> statement-breakpoint
CREATE TABLE "dispatcher_background_task_index_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"computed_source_revision" integer DEFAULT -1 NOT NULL,
	"computed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatcher_background_row_tasks" ADD CONSTRAINT "dispatcher_background_row_tasks_weld_joint_id_weld_joints_id_fk" FOREIGN KEY ("weld_joint_id") REFERENCES "public"."weld_joints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatcher_background_row_tasks_code_idx" ON "dispatcher_background_row_tasks" USING btree ("code");--> statement-breakpoint
CREATE INDEX "dispatcher_background_row_tasks_task_key_idx" ON "dispatcher_background_row_tasks" USING btree ("task_key");