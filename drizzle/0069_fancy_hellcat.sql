ALTER TABLE "line_scheme_annotations" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD COLUMN "color" text DEFAULT '#64748b' NOT NULL;--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD COLUMN "stroke_width" numeric DEFAULT 1.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "line_scheme_annotations" ADD CONSTRAINT "line_scheme_annotations_note_check" CHECK (length("line_scheme_annotations"."note") <= 1000);--> statement-breakpoint
ALTER TABLE "line_scheme_dimensions" ADD CONSTRAINT "line_scheme_dimensions_style_check" CHECK ("line_scheme_dimensions"."color" in ('#64748b', '#111827', '#dc2626', '#2563eb', '#16a34a', '#ea580c', '#6b7280') and "line_scheme_dimensions"."stroke_width" in (1, 1.5, 2, 3));