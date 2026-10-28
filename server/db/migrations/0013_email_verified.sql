ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Everyone who has an account now got it before sign-up existed: they count as verified.
UPDATE "users" SET "email_verified_at" = "created_at";
