CREATE TABLE "technology_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"welding_methods" text[] NOT NULL,
	"connection_type" text NOT NULL,
	"material_groups" text[] NOT NULL,
	"diameter_from" numeric(12, 3) NOT NULL,
	"diameter_to" numeric(12, 3) NOT NULL,
	"thickness_from" numeric(12, 3) NOT NULL,
	"thickness_to" numeric(12, 3) NOT NULL,
	"psto" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"first_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technology_cards_name_required" CHECK ("technology_cards"."name" = btrim("technology_cards"."name") and "technology_cards"."name" <> ''),
	CONSTRAINT "technology_cards_methods_required" CHECK (cardinality("technology_cards"."welding_methods") > 0 and array_position("technology_cards"."welding_methods", null) is null and array_position("technology_cards"."welding_methods", '') is null),
	CONSTRAINT "technology_cards_connection_required" CHECK (btrim("technology_cards"."connection_type") <> '' and upper(left(btrim("technology_cards"."connection_type"), 1)) <> 'Т'),
	CONSTRAINT "technology_cards_groups_count" CHECK (cardinality("technology_cards"."material_groups") between 1 and 2 and array_position("technology_cards"."material_groups", null) is null and array_position("technology_cards"."material_groups", '') is null and (cardinality("technology_cards"."material_groups") = 1 or "technology_cards"."material_groups"[1] <> "technology_cards"."material_groups"[2])),
	CONSTRAINT "technology_cards_diameter_range" CHECK ("technology_cards"."diameter_from" > 0 and "technology_cards"."diameter_to" >= "technology_cards"."diameter_from"),
	CONSTRAINT "technology_cards_thickness_range" CHECK ("technology_cards"."thickness_from" > 0 and "technology_cards"."thickness_to" >= "technology_cards"."thickness_from"),
	CONSTRAINT "technology_cards_psto_value" CHECK ("technology_cards"."psto" in ('required', 'not-required', 'any')),
	CONSTRAINT "technology_cards_revision_positive" CHECK ("technology_cards"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "technology_cards_name_idx" ON "technology_cards" USING btree ("name");--> statement-breakpoint
CREATE INDEX "weld_joints_technology_card_name_idx" ON "weld_joints" USING btree (btrim("technology_card_number"));