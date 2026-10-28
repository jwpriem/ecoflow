CREATE TABLE "job_locks" (
	"job" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"locked_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "sites_timed_out" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "errors" jsonb DEFAULT '[]'::jsonb NOT NULL;