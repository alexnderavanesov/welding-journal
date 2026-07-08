CREATE TABLE IF NOT EXISTS "duplicate_controls" (
  "id" serial PRIMARY KEY NOT NULL,
  "weld_joint_id" integer NOT NULL REFERENCES "weld_joints"("id") ON DELETE CASCADE,
  "method" text NOT NULL,
  "result" text NOT NULL,
  "control_date" date,
  "conclusion" text,
  "conclusion_date" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "duplicate_controls_weld_joint_id_idx" ON "duplicate_controls" ("weld_joint_id");
