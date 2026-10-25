CREATE TABLE "vehicle_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"soc" double precision,
	"range_km" double precision,
	"charge_power_w" double precision,
	"charging" boolean DEFAULT false NOT NULL,
	"plugged_in" boolean DEFAULT false NOT NULL,
	"at_home" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"provider" text DEFAULT 'zeekr' NOT NULL,
	"vin" text NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"capacity_kwh" double precision,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_samples" ADD CONSTRAINT "vehicle_samples_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_samples" ADD CONSTRAINT "vehicle_samples_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_samples_vehicle_ts" ON "vehicle_samples" USING btree ("vehicle_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_site_vin" ON "vehicles" USING btree ("site_id","vin");