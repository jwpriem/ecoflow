CREATE TABLE "job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"sites_ok" integer NOT NULL,
	"sites_failed" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "job_runs_job_started" ON "job_runs" USING btree ("job","started_at");