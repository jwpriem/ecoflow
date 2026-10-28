-- Households that exist already keep the typical load and output limit they have: set by hand, as before.
-- New households start with both worked out for them (defaultStrategy).
UPDATE "sites" SET "strategy" = "strategy" || '{"avgLoadAuto": false, "maxOutputAuto": false}'::jsonb;
