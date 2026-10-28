ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "experimental" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The first account is the one that ran the app until now: it becomes the admin.
UPDATE "users" SET "role" = 'admin' WHERE "id" = (SELECT min("id") FROM "users");
