ALTER TABLE "weld_joints" ADD COLUMN "vik_request" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "rk_request" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "pvk_request" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "uzk_request" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "tvmt_request" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "rfa_request" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "stls_request" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "mkk_request" text;--> statement-breakpoint
UPDATE "weld_joints"
SET
	"vik_request" = CASE WHEN "lnk_request" ILIKE '%ВИК%' THEN "lnk_request" ELSE "vik_request" END,
	"rk_request" = CASE WHEN "lnk_request" ILIKE '%РК%' THEN "lnk_request" ELSE "rk_request" END,
	"pvk_request" = CASE WHEN "lnk_request" ILIKE '%ПВК%' THEN "lnk_request" ELSE "pvk_request" END,
	"uzk_request" = CASE WHEN "lnk_request" ILIKE '%УЗК%' THEN "lnk_request" ELSE "uzk_request" END,
	"tvmt_request" = CASE WHEN "lnk_request" ILIKE '%ТВМТ%' THEN "lnk_request" ELSE "tvmt_request" END,
	"rfa_request" = CASE WHEN "lnk_request" ILIKE '%РФА%' THEN "lnk_request" ELSE "rfa_request" END,
	"stls_request" = CASE WHEN "lnk_request" ILIKE '%СТЛС%' THEN "lnk_request" ELSE "stls_request" END,
	"mkk_request" = CASE WHEN "lnk_request" ILIKE '%МКК%' THEN "lnk_request" ELSE "mkk_request" END
WHERE "lnk_request" IS NOT NULL AND trim("lnk_request") <> '';--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "lnk_request";
