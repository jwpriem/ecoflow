CREATE TABLE "irradiance" (
	"site_id" integer NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"ghi" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "irradiance_site_id_slot_start_pk" PRIMARY KEY("site_id","slot_start")
);
--> statement-breakpoint
ALTER TABLE "irradiance" ADD CONSTRAINT "irradiance_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;