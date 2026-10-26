-- Rebook loss_kwh as a signed value (see server/lib/ledger.ts). Each slot's pool starts at the previous slot's
-- measured SoC, so the loss is that plus charged - discharged - this slot's measured SoC.
UPDATE "ledger" AS l
SET "loss_kwh" = x.prev_kwh + l.charged_solar_kwh + l.charged_grid_kwh - l.discharged_kwh - x.end_kwh
FROM (
	SELECT g.device_id, g.slot_start,
		g.soc_end * d.capacity_wh / 1000 AS end_kwh,
		lag(g.soc_end * d.capacity_wh / 1000) OVER w AS prev_kwh,
		lag(g.slot_start) OVER w AS prev_slot
	FROM "ledger" AS g JOIN "devices" AS d ON d.id = g.device_id
	WINDOW w AS (PARTITION BY g.device_id ORDER BY g.slot_start)
) AS x
WHERE x.device_id = l.device_id AND x.slot_start = l.slot_start
	AND x.prev_slot = l.slot_start - interval '15 minutes' AND x.prev_kwh IS NOT NULL AND x.end_kwh IS NOT NULL;
