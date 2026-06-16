ALTER TABLE "weld_joints" ADD COLUMN "lnk_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "vik_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "vik_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "rk_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "rk_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "pvk_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "pvk_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "uzk_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "uzk_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "tvmt_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "tvmt_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "rfa_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "rfa_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "stls_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "stls_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "mkk_boq" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "mkk_ks3" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "vik_conclusion" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "rk_conclusion" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "pvk_conclusion" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "uzk_conclusion" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "tvmt_conclusion" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "rfa_conclusion" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "stls_conclusion" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "mkk_conclusion" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "lnk_defect_description" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "lnk_note" text;--> statement-breakpoint
UPDATE "weld_joints"
SET "lnk_created_at" = COALESCE("lnk_created_at", "created_at", now())
WHERE
  COALESCE("has_vik", false)
  OR COALESCE("has_rk", false)
  OR COALESCE("has_pvk", false)
  OR COALESCE("has_uzk", false)
  OR COALESCE("has_tvmt", false)
  OR COALESCE("has_rfa", false)
  OR COALESCE("has_stls", false)
  OR COALESCE("has_mkk", false);
