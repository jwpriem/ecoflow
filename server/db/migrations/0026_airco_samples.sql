CREATE TABLE "airco_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"appliance_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"running" boolean DEFAULT false NOT NULL,
	"mode" text,
	"target_c" double precision,
	"indoor_c" double precision,
	"outdoor_c" double precision
);
--> statement-breakpoint
ALTER TABLE "airco_samples" ADD CONSTRAINT "airco_samples_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "airco_samples_site_appliance_ts" ON "airco_samples" USING btree ("site_id","appliance_id","ts");