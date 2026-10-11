CREATE TABLE "document_operation_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
