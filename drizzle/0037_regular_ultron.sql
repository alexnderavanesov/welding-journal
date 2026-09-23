CREATE TABLE "dispatcher_task_pages" (
	"scope_key" text NOT NULL,
	"page_number" integer NOT NULL,
	"task_count" integer NOT NULL,
	"tasks" text NOT NULL,
	CONSTRAINT "dispatcher_task_pages_scope_key_page_number_pk" PRIMARY KEY("scope_key","page_number")
);
