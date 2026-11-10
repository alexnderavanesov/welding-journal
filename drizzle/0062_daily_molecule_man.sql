CREATE TABLE "line_scheme_bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"line_program_id" integer NOT NULL,
	"project_title" text NOT NULL,
	"subtitle_code" text NOT NULL,
	"line" text NOT NULL,
	"active_revision_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"lock_user_id" text,
	"lock_name" text,
	"lock_token" text,
	"lock_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_scheme_bundles_line_program_id_unique" UNIQUE("line_program_id")
);
--> statement-breakpoint
CREATE TABLE "line_scheme_files" (
	"key" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_scheme_files_state_check" CHECK ("line_scheme_files"."state" in ('staging','ready','deleting'))
);
--> statement-breakpoint
CREATE TABLE "line_scheme_members" (
	"weld_joint_id" integer PRIMARY KEY NOT NULL,
	"physical_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_scheme_physicals" (
	"id" serial PRIMARY KEY NOT NULL,
	"seed_node_id" integer NOT NULL,
	"last_label" text NOT NULL,
	"last_line_program_id" integer,
	CONSTRAINT "line_scheme_physicals_seed_node_id_unique" UNIQUE("seed_node_id")
);
--> statement-breakpoint
CREATE TABLE "line_scheme_points" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"physical_id" integer NOT NULL,
	"page" integer NOT NULL,
	"x" numeric(12, 3) NOT NULL,
	"y" numeric(12, 3) NOT NULL,
	CONSTRAINT "line_scheme_points_coordinates_check" CHECK ("line_scheme_points"."page" between 1 and 100 and "line_scheme_points"."x" between 0 and 1 and "line_scheme_points"."y" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "line_scheme_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"bundle_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_scheme_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"bundle_id" integer NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL,
	"page_count" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_scheme_revisions_file_key_unique" UNIQUE("file_key"),
	CONSTRAINT "line_scheme_revisions_size_check" CHECK ("line_scheme_revisions"."size" > 0 and "line_scheme_revisions"."size" <= 104857600),
	CONSTRAINT "line_scheme_revisions_pages_check" CHECK ("line_scheme_revisions"."page_count" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "line_scheme_members" ADD CONSTRAINT "line_scheme_members_physical_id_line_scheme_physicals_id_fk" FOREIGN KEY ("physical_id") REFERENCES "public"."line_scheme_physicals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_scheme_points" ADD CONSTRAINT "line_scheme_points_revision_id_line_scheme_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."line_scheme_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_scheme_points" ADD CONSTRAINT "line_scheme_points_physical_id_line_scheme_physicals_id_fk" FOREIGN KEY ("physical_id") REFERENCES "public"."line_scheme_physicals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_scheme_receipts" ADD CONSTRAINT "line_scheme_receipts_bundle_id_line_scheme_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."line_scheme_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_scheme_revisions" ADD CONSTRAINT "line_scheme_revisions_bundle_id_line_scheme_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."line_scheme_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_scheme_revisions" ADD CONSTRAINT "line_scheme_revisions_file_key_line_scheme_files_key_fk" FOREIGN KEY ("file_key") REFERENCES "public"."line_scheme_files"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_scheme_files_cleanup_idx" ON "line_scheme_files" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "line_scheme_members_physical_idx" ON "line_scheme_members" USING btree ("physical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "line_scheme_points_physical_idx" ON "line_scheme_points" USING btree ("revision_id","physical_id");--> statement-breakpoint
CREATE INDEX "line_scheme_points_page_idx" ON "line_scheme_points" USING btree ("revision_id","page","id");--> statement-breakpoint
CREATE INDEX "line_scheme_receipts_bundle_idx" ON "line_scheme_receipts" USING btree ("bundle_id","created_at");--> statement-breakpoint
CREATE INDEX "line_scheme_revisions_bundle_idx" ON "line_scheme_revisions" USING btree ("bundle_id","created_at");