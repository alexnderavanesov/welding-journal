CREATE TABLE "work_closures" (
	"weld_joint_id" integer NOT NULL,
	"work_type" text NOT NULL,
	"rate_code" text DEFAULT '' NOT NULL,
	"act_number" text DEFAULT '' NOT NULL,
	CONSTRAINT "work_closures_weld_joint_id_work_type_pk" PRIMARY KEY("weld_joint_id","work_type")
);
--> statement-breakpoint
ALTER TABLE "work_closures" ADD CONSTRAINT "work_closures_weld_joint_id_weld_joints_id_fk" FOREIGN KEY ("weld_joint_id") REFERENCES "public"."weld_joints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_closures_rate_idx" ON "work_closures" USING btree ("rate_code","weld_joint_id");--> statement-breakpoint
CREATE INDEX "work_closures_act_idx" ON "work_closures" USING btree ("act_number","weld_joint_id");--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "test_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "pi_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "test_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "pi_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "psto_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "psto_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "vik_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "vik_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rk_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "rk_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "pvk_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "pvk_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "uzk_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "uzk_ks3";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "tvmt_boq";--> statement-breakpoint
ALTER TABLE "weld_joints" DROP COLUMN "tvmt_ks3";