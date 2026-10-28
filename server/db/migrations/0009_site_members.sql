CREATE TABLE "site_members" (
	"site_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_members_site_id_user_id_pk" PRIMARY KEY("site_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "site_members" ADD CONSTRAINT "site_members_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_members" ADD CONSTRAINT "site_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_members_user" ON "site_members" USING btree ("user_id");--> statement-breakpoint
-- Every existing site's creator becomes its owner. A user with more than one site keeps the oldest, the one
-- requireSite() already picked.
INSERT INTO "site_members" ("site_id", "user_id", "role", "created_at")
SELECT DISTINCT ON ("user_id") "id", "user_id", 'owner', "created_at" FROM "sites" ORDER BY "user_id", "id"
ON CONFLICT DO NOTHING;
