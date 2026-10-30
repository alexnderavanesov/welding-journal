ALTER TABLE "auth_sessions" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "last_active_at" timestamp with time zone;