CREATE TABLE "solar_ledger" (
	"site_id" integer NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"produced_kwh" double precision NOT NULL,
	"self_used_kwh" double precision NOT NULL,
	"exported_kwh" double precision NOT NULL,
	"to_battery_kwh" double precision NOT NULL,
	"price_total" double precision NOT NULL,
	"price_feed_in" double precision NOT NULL,
	"value_self_used" double precision NOT NULL,
	"value_exported" double precision NOT NULL,
	"value_to_battery" double precision NOT NULL,
	CONSTRAINT "solar_ledger_site_id_slot_start_pk" PRIMARY KEY("site_id","slot_start")
);
--> statement-breakpoint
CREATE TABLE "solar_production" (
	"site_id" integer NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"avg_w" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solar_production_site_id_slot_start_pk" PRIMARY KEY("site_id","slot_start")
);
--> statement-breakpoint
ALTER TABLE "solar_ledger" ADD CONSTRAINT "solar_ledger_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_production" ADD CONSTRAINT "solar_production_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;