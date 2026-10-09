CREATE TABLE "technology_card_names" (
	"name" text PRIMARY KEY NOT NULL,
	"technology_card_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technology_card_names_name_required" CHECK ("technology_card_names"."name" = btrim("technology_card_names"."name") and "technology_card_names"."name" <> '')
);
--> statement-breakpoint
ALTER TABLE "technology_card_names" ADD CONSTRAINT "technology_card_names_technology_card_id_technology_cards_id_fk" FOREIGN KEY ("technology_card_id") REFERENCES "public"."technology_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "technology_card_names_card_idx" ON "technology_card_names" USING btree ("technology_card_id");