CREATE TABLE "audit_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"label" text NOT NULL,
	"joint_id" integer,
	"area" text NOT NULL,
	"kind" text NOT NULL,
	"changes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"area" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_owner" (
	"singleton" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_owner_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "auth_owner_singleton_check" CHECK ("auth_owner"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" numeric(20, 0) NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"title" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_generation" integer DEFAULT 0 NOT NULL,
	"link_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_role_check" CHECK ("auth_users"."role" in ('owner','admin','user')),
	CONSTRAINT "auth_users_status_check" CHECK ("auth_users"."status" in ('pending','active'))
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_changes" ADD CONSTRAINT "audit_changes_operation_id_audit_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."audit_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_owner" ADD CONSTRAINT "auth_owner_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_changes_operation_idx" ON "audit_changes" USING btree ("operation_id","id");--> statement-breakpoint
CREATE INDEX "audit_changes_joint_idx" ON "audit_changes" USING btree ("joint_id","id");--> statement-breakpoint
CREATE INDEX "audit_changes_entity_idx" ON "audit_changes" USING btree ("entity","entity_id","id");--> statement-breakpoint
CREATE INDEX "audit_operations_time_idx" ON "audit_operations" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "audit_operations_actor_time_idx" ON "audit_operations" USING btree ("actor_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_operations_action_time_idx" ON "audit_operations" USING btree ("action","created_at","id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_idx" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_idx" ON "auth_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");