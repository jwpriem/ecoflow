ALTER TABLE "devices" ALTER COLUMN "driver" SET DEFAULT 'ecoflow_official';--> statement-breakpoint
CREATE UNIQUE INDEX "devices_site_serial" ON "devices" USING btree ("site_id","serial");--> statement-breakpoint
-- Remove the simulated batteries and everything derived from them. The grid samples of those sites were
-- the Pulse reading plus the simulated batteries, and the plans used their simulated charge level.
DELETE FROM "samples" WHERE "kind" = 'grid' AND "site_id" IN (SELECT "site_id" FROM "devices" WHERE "driver" = 'mock');--> statement-breakpoint
DELETE FROM "plans" WHERE "site_id" IN (SELECT "site_id" FROM "devices" WHERE "driver" = 'mock');--> statement-breakpoint
DELETE FROM "devices" WHERE "driver" = 'mock';--> statement-breakpoint
DELETE FROM "prices" WHERE "source" = 'fake';
