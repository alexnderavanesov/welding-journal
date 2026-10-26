CREATE TABLE "psto_chain_exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"line_program_id" integer NOT NULL,
	"root_joint" text NOT NULL,
	"required" boolean NOT NULL,
	"basis" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	CONSTRAINT "psto_chain_exceptions_root_check" CHECK ("psto_chain_exceptions"."root_joint" = lower(btrim("psto_chain_exceptions"."root_joint")) and "psto_chain_exceptions"."root_joint" <> ''),
	CONSTRAINT "psto_chain_exceptions_basis_check" CHECK (btrim("psto_chain_exceptions"."basis") <> ''),
	CONSTRAINT "psto_chain_exceptions_closure_check" CHECK (("psto_chain_exceptions"."closed_at" is null) = ("psto_chain_exceptions"."close_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "line_programs" ADD COLUMN "psto_assignment" text;--> statement-breakpoint
ALTER TABLE "line_programs" ADD COLUMN "psto_cancellation_date" date;--> statement-breakpoint
ALTER TABLE "line_programs" ADD COLUMN "psto_cancellation_basis" text;--> statement-breakpoint
ALTER TABLE "weld_joints" ADD COLUMN "psto_exception_basis" text;--> statement-breakpoint
ALTER TABLE "psto_chain_exceptions" ADD CONSTRAINT "psto_chain_exceptions_line_program_id_line_programs_id_fk" FOREIGN KEY ("line_program_id") REFERENCES "public"."line_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "psto_chain_exceptions_active_idx" ON "psto_chain_exceptions" USING btree ("line_program_id","root_joint") WHERE "psto_chain_exceptions"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "psto_chain_exceptions_history_idx" ON "psto_chain_exceptions" USING btree ("line_program_id","created_at","id");--> statement-breakpoint
ALTER TABLE "line_programs" ADD CONSTRAINT "line_programs_psto_assignment_check" CHECK ("line_programs"."psto_assignment" in ('assigned', 'unassigned', 'cancelled'));