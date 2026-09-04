DROP INDEX "weld_joints_normalized_line_identity_idx";--> statement-breakpoint
CREATE INDEX "weld_joints_normalized_line_identity_idx" ON "weld_joints" USING btree (lower(btrim(coalesce("project_title", ''))),lower(btrim(coalesce("subtitle_code", ''))),lower(btrim(coalesce("line", ''))));--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "has_rfa";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "has_stls";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "has_mkk";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rfa_control_basis";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "stls_control_basis";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "mkk_control_basis";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rfa_request";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rfa_request_date";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "stls_request";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "stls_request_date";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "mkk_request";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "mkk_request_date";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rfa_result";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "stls_result";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "mkk_result";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rfa_conclusion_date";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rfa_conclusion";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "stls_conclusion_date";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "stls_conclusion";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "mkk_conclusion_date";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "mkk_conclusion";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rfa_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rfa_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "stls_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "stls_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "mkk_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "mkk_ks3";