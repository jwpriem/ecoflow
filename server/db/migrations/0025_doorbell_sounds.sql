CREATE TABLE "doorbell_sounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"audio" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doorbell_sounds_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "doorbell_sounds" ADD CONSTRAINT "doorbell_sounds_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doorbell_sounds_site" ON "doorbell_sounds" USING btree ("site_id");