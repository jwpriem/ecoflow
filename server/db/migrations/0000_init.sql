CREATE TABLE "battery_pool" (
	"device_id" integer PRIMARY KEY NOT NULL,
	"kwh" double precision NOT NULL,
	"cost_naive" double precision NOT NULL,
	"cost_opportunity" double precision NOT NULL,
	"next_slot" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commands_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"command" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"driver" text DEFAULT 'mock' NOT NULL,
	"serial" text NOT NULL,
	"name" text NOT NULL,
	"model" text DEFAULT 'STREAM Pro' NOT NULL,
	"capacity_wh" integer DEFAULT 1920 NOT NULL,
	"max_charge_w" integer DEFAULT 1200 NOT NULL,
	"max_discharge_w" integer DEFAULT 800 NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"provider" text NOT NULL,
	"credentials_enc" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"device_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"charged_solar_kwh" double precision NOT NULL,
	"charged_grid_kwh" double precision NOT NULL,
	"discharged_kwh" double precision NOT NULL,
	"price_total" double precision NOT NULL,
	"price_feed_in" double precision NOT NULL,
	"cost_naive" double precision NOT NULL,
	"cost_opportunity" double precision NOT NULL,
	"value_discharged" double precision NOT NULL,
	"saving_naive" double precision NOT NULL,
	"saving_opportunity" double precision NOT NULL,
	"loss_kwh" double precision DEFAULT 0 NOT NULL,
	"soc_end" double precision,
	CONSTRAINT "ledger_device_id_slot_start_pk" PRIMARY KEY("device_id","slot_start")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"site_id" integer NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"target_w" integer,
	"price" double precision NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_site_id_slot_start_pk" PRIMARY KEY("site_id","slot_start")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"site_id" integer NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_minutes" integer DEFAULT 15 NOT NULL,
	"energy" double precision NOT NULL,
	"tax" double precision NOT NULL,
	"total" double precision NOT NULL,
	"feed_in" double precision NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "prices_site_id_slot_start_pk" PRIMARY KEY("site_id","slot_start")
);
--> statement-breakpoint
CREATE TABLE "samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"device_id" integer,
	"ts" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"power_w" double precision NOT NULL,
	"soc" double precision,
	"pv_w" double precision
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Amsterdam' NOT NULL,
	"strategy" jsonb NOT NULL,
	"control_mode" text DEFAULT 'auto' NOT NULL,
	"override" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "battery_pool" ADD CONSTRAINT "battery_pool_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands_log" ADD CONSTRAINT "commands_log_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commands_device_ts" ON "commands_log" USING btree ("device_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_site_provider" ON "integrations" USING btree ("site_id","provider");--> statement-breakpoint
CREATE INDEX "ledger_site_slot" ON "ledger" USING btree ("site_id","slot_start");--> statement-breakpoint
CREATE INDEX "samples_site_kind_ts" ON "samples" USING btree ("site_id","kind","ts");--> statement-breakpoint
CREATE INDEX "samples_device_ts" ON "samples" USING btree ("device_id","ts");