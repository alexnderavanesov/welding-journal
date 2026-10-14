CREATE TABLE "specialists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"certificate" text NOT NULL,
	"methods" text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "specialists_kind_check" CHECK ("specialists"."kind" in ('inspector', 'thermist')),
	CONSTRAINT "specialists_name_check" CHECK (btrim("specialists"."name") <> ''),
	CONSTRAINT "specialists_certificate_check" CHECK (btrim("specialists"."certificate") <> '')
);
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD COLUMN "specialists" jsonb;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD COLUMN "specialists_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "specialists_name_idx" ON "specialists" USING btree ("name","id");