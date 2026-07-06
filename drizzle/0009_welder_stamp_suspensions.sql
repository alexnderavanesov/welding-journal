CREATE TABLE IF NOT EXISTS "welder_stamp_suspensions" (
  "id" serial PRIMARY KEY NOT NULL,
  "naks_stamp" text NOT NULL,
  "suspended_from" date NOT NULL,
  "suspended_to" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
