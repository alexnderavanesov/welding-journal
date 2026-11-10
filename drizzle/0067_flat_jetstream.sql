CREATE TABLE "line_scheme_annotations" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"page" integer NOT NULL,
	"x" numeric(12, 9) NOT NULL,
	"y" numeric(12, 9) NOT NULL,
	"shape" text NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"size" integer NOT NULL,
	"stroke_width" integer NOT NULL,
	"rotation" integer NOT NULL,
	CONSTRAINT "line_scheme_annotations_position_check" CHECK ("line_scheme_annotations"."page" between 1 and 100 and "line_scheme_annotations"."x" between 0 and 1 and "line_scheme_annotations"."y" between 0 and 1),
	CONSTRAINT "line_scheme_annotations_shape_check" CHECK ("line_scheme_annotations"."shape" in ('dot', 'triangle', 'line')),
	CONSTRAINT "line_scheme_annotations_style_check" CHECK ("line_scheme_annotations"."size" in (16, 24, 32) and "line_scheme_annotations"."stroke_width" between 1 and 3 and "line_scheme_annotations"."rotation" between 0 and 359),
	CONSTRAINT "line_scheme_annotations_label_check" CHECK (length(btrim("line_scheme_annotations"."label")) between 1 and 120),
	CONSTRAINT "line_scheme_annotations_color_check" CHECK ("line_scheme_annotations"."color" in ('#475569', '#0284c7', '#7c3aed', '#0f766e'))
);
--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" DROP CONSTRAINT "line_scheme_dimensions_pair_check";--> statement-breakpoint
DROP INDEX "line_scheme_dimensions_pair_idx";--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ALTER COLUMN "from_point_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ALTER COLUMN "to_point_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD COLUMN "from_annotation_id" text;--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD COLUMN "to_annotation_id" text;--> statement-breakpoint
ALTER TABLE "line_scheme_annotations" ADD CONSTRAINT "line_scheme_annotations_revision_id_line_scheme_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."line_scheme_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_scheme_annotations_page_idx" ON "line_scheme_annotations" USING btree ("revision_id","page","id");--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD CONSTRAINT "line_scheme_dimensions_from_annotation_id_line_scheme_annotations_id_fk" FOREIGN KEY ("from_annotation_id") REFERENCES "public"."line_scheme_annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD CONSTRAINT "line_scheme_dimensions_to_annotation_id_line_scheme_annotations_id_fk" FOREIGN KEY ("to_annotation_id") REFERENCES "public"."line_scheme_annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_scheme_dimensions_from_annotation_idx" ON "line_scheme_dimensions" USING btree ("from_annotation_id");--> statement-breakpoint
CREATE INDEX "line_scheme_dimensions_to_annotation_idx" ON "line_scheme_dimensions" USING btree ("to_annotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "line_scheme_dimensions_pair_idx" ON "line_scheme_dimensions" USING btree ("revision_id",coalesce('p:' || "from_point_id", 'a:' || "from_annotation_id"),coalesce('p:' || "to_point_id", 'a:' || "to_annotation_id"));--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD CONSTRAINT "line_scheme_dimensions_endpoints_check" CHECK (num_nonnulls("line_scheme_dimensions"."from_point_id", "line_scheme_dimensions"."from_annotation_id") = 1 and num_nonnulls("line_scheme_dimensions"."to_point_id", "line_scheme_dimensions"."to_annotation_id") = 1);--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD CONSTRAINT "line_scheme_dimensions_pair_check" CHECK (coalesce('p:' || "line_scheme_dimensions"."from_point_id", 'a:' || "line_scheme_dimensions"."from_annotation_id") < coalesce('p:' || "line_scheme_dimensions"."to_point_id", 'a:' || "line_scheme_dimensions"."to_annotation_id"));