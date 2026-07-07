CREATE TABLE IF NOT EXISTS "dispatcher_accepted_warnings" (
  "key" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "title" text,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
