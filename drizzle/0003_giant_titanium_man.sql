ALTER TABLE "weld_joints" ADD COLUMN "psto_date" date;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "heat_treatment_diagram" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "psto_note" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "psto_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "psto_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "psto_created_at" timestamp with time zone;--> statement-breakpoint
UPDATE "weld_joints"
SET "psto_created_at" = COALESCE("psto_created_at", "created_at", now())
WHERE lower(trim(COALESCE("psto_required", ''))) = 'да';
