CREATE TABLE "line_scheme_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"from_point_id" text NOT NULL,
	"to_point_id" text NOT NULL,
	"page" integer NOT NULL,
	"distance_mm" numeric NOT NULL,
	"offset_x" numeric(12, 9) NOT NULL,
	"offset_y" numeric(12, 9) NOT NULL,
	CONSTRAINT "line_scheme_dimensions_value_check" CHECK ("line_scheme_dimensions"."distance_mm" > 0 and "line_scheme_dimensions"."distance_mm" < 'Infinity'::numeric),
	CONSTRAINT "line_scheme_dimensions_pair_check" CHECK ("line_scheme_dimensions"."from_point_id" < "line_scheme_dimensions"."to_point_id"),
	CONSTRAINT "line_scheme_dimensions_position_check" CHECK ("line_scheme_dimensions"."page" between 1 and 100 and "line_scheme_dimensions"."offset_x" between -1 and 1 and "line_scheme_dimensions"."offset_y" between -1 and 1)
);
--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD CONSTRAINT "line_scheme_dimensions_revision_id_line_scheme_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."line_scheme_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD CONSTRAINT "line_scheme_dimensions_from_point_id_line_scheme_points_id_fk" FOREIGN KEY ("from_point_id") REFERENCES "public"."line_scheme_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD CONSTRAINT "line_scheme_dimensions_to_point_id_line_scheme_points_id_fk" FOREIGN KEY ("to_point_id") REFERENCES "public"."line_scheme_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "line_scheme_dimensions_pair_idx" ON "line_scheme_dimensions" USING btree ("revision_id","from_point_id","to_point_id");--> statement-breakpoint
CREATE INDEX "line_scheme_dimensions_page_idx" ON "line_scheme_dimensions" USING btree ("revision_id","page");--> statement-breakpoint
CREATE INDEX "line_scheme_dimensions_from_idx" ON "line_scheme_dimensions" USING btree ("from_point_id");--> statement-breakpoint
CREATE INDEX "line_scheme_dimensions_to_idx" ON "line_scheme_dimensions" USING btree ("to_point_id");