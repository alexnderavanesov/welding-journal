CREATE TABLE "pre_heat_treatment_controls" (
	"id" serial PRIMARY KEY NOT NULL,
	"weld_joint_id" integer NOT NULL,
	"method" text NOT NULL,
	"request_name" text,
	"request_date" date,
	"result" text,
	"conclusion_date" date,
	"conclusion_name" text,
	"defect_description" text,
	"rk_exposure_confirmed_diameter" numeric(12, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_heat_treatment_controls_method_check" CHECK ("pre_heat_treatment_controls"."method" in ('ВИК', 'РК', 'УЗК', 'ПВК'))
);
--> statement-breakpoint
CREATE TABLE "psto_repeat_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"weld_joint_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"psto_request" text,
	"psto_request_date" date,
	"psto_date" date,
	"heat_treatment_diagram" text,
	"psto_result" text,
	"psto_note" text,
	"tvmt_request" text,
	"tvmt_request_date" date,
	"tvmt_result" text,
	"tvmt_conclusion_date" date,
	"tvmt_conclusion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psto_repeat_cycles_sequence_check" CHECK ("psto_repeat_cycles"."sequence" >= 2)
);
--> statement-breakpoint
ALTER TABLE "pre_heat_treatment_controls" ADD CONSTRAINT "pre_heat_treatment_controls_weld_joint_id_weld_joints_id_fk" FOREIGN KEY ("weld_joint_id") REFERENCES "public"."weld_joints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psto_repeat_cycles" ADD CONSTRAINT "psto_repeat_cycles_weld_joint_id_weld_joints_id_fk" FOREIGN KEY ("weld_joint_id") REFERENCES "public"."weld_joints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_heat_treatment_controls_weld_method_uidx" ON "pre_heat_treatment_controls" USING btree ("weld_joint_id","method");--> statement-breakpoint
CREATE INDEX "pre_heat_treatment_controls_request_idx" ON "pre_heat_treatment_controls" USING btree ("method","request_date","request_name");--> statement-breakpoint
CREATE INDEX "pre_heat_treatment_controls_conclusion_idx" ON "pre_heat_treatment_controls" USING btree ("method","conclusion_date","conclusion_name");--> statement-breakpoint
CREATE UNIQUE INDEX "psto_repeat_cycles_weld_sequence_uidx" ON "psto_repeat_cycles" USING btree ("weld_joint_id","sequence");--> statement-breakpoint
CREATE INDEX "psto_repeat_cycles_psto_request_idx" ON "psto_repeat_cycles" USING btree ("psto_request_date","psto_request");--> statement-breakpoint
CREATE INDEX "psto_repeat_cycles_tvmt_request_idx" ON "psto_repeat_cycles" USING btree ("tvmt_request_date","tvmt_request");