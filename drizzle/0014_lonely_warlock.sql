CREATE TABLE "document_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"blob_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"metadata" text NOT NULL,
	"options" text,
	"constructor_config" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_document_weld_joints" (
	"document_id" integer NOT NULL,
	"weld_joint_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_document_weld_joints_document_id_weld_joint_id_pk" PRIMARY KEY("document_id","weld_joint_id")
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"row_count" integer DEFAULT 0 NOT NULL,
	"wdi_total" numeric(12, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_document_weld_joints" ADD CONSTRAINT "generated_document_weld_joints_document_id_generated_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."generated_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_document_weld_joints" ADD CONSTRAINT "generated_document_weld_joints_weld_joint_id_weld_joints_id_fk" FOREIGN KEY ("weld_joint_id") REFERENCES "public"."weld_joints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generated_document_weld_joints_weld_joint_idx" ON "generated_document_weld_joints" USING btree ("weld_joint_id");--> statement-breakpoint
CREATE INDEX "generated_documents_type_created_at_idx" ON "generated_documents" USING btree ("type","created_at");