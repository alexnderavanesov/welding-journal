CREATE TABLE "derived_calculation_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"source_revision" integer NOT NULL,
	"payload" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "derived_calculation_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"source_revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "derived_calculation_cache_source_revision_idx" ON "derived_calculation_cache" USING btree ("source_revision");