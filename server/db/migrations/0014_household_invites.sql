CREATE TABLE "household_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_invites_site" ON "household_invites" USING btree ("site_id");--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Every subscription so far was made by the household's owner: there were no members yet
UPDATE "push_subscriptions" p SET "user_id" = m."user_id" FROM "site_members" m WHERE m."site_id" = p."site_id" AND m."role" = 'owner';
