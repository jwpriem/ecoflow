-- Households that WattsWise already steers keep steering: their owner counts as having accepted the first
-- steering disclaimer (2026-10-29), which describes what they already agreed to by turning steering on.
INSERT INTO "consents" ("user_id", "kind", "version")
SELECT "site_members"."user_id", 'steering', '2026-10-29'
FROM "sites" JOIN "site_members" ON "site_members"."site_id" = "sites"."id" AND "site_members"."role" = 'owner'
WHERE "sites"."control_mode" = 'auto'
ON CONFLICT DO NOTHING;
