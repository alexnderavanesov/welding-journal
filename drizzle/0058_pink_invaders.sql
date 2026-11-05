ALTER TABLE "technology_cards" DROP CONSTRAINT "technology_cards_connection_required";--> statement-breakpoint
ALTER TABLE "line_programs" ADD COLUMN "support_uzk_control_percent" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "line_programs" ADD COLUMN "support_pvk_control_percent" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "weld_length" numeric;--> statement-breakpoint
ALTER TABLE "line_programs" ADD CONSTRAINT "line_programs_support_uzk_range" CHECK ("line_programs"."support_uzk_control_percent" between 0.5 and 100);--> statement-breakpoint
ALTER TABLE "line_programs" ADD CONSTRAINT "line_programs_support_pvk_range" CHECK ("line_programs"."support_pvk_control_percent" between 0.5 and 100);--> statement-breakpoint
ALTER TABLE "technology_cards" ADD CONSTRAINT "technology_cards_connection_required" CHECK (btrim("technology_cards"."connection_type") <> '');