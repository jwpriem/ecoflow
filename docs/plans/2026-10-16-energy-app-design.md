# EcoFlow energy app: design

Status: draft for review · 2026-10-16 (model confirmed: STREAM Pro)

## Goal

A personal app (web first, later a native app via Capacitor) that:

1. Shows the live state of two EcoFlow Stream batteries.
2. Keeps a ledger of every kWh going in and out of the batteries and calculates what they save, per 15 min, hour, day, month and year.
3. Steers the batteries: charge on solar surplus or in the cheapest grid slots, discharge in the most expensive slots.

Inputs: 2× EcoFlow **STREAM Pro** (1920 Wh each, 3.84 kWh total), SolarEdge inverter, Tibber dynamic contract with a Tibber Pulse.

## Decisions so far

| Topic | Decision |
|---|---|
| Frontend | Nuxt 4 (Vue), SPA mode for the Capacitor build |
| Backend | Nitro server in the same Nuxt project, on **DigitalOcean App Platform**. It is a long-running web service, which is needed for polling, the Pulse websocket and the control loop |
| Database | **Neon** Postgres, with Drizzle ORM |
| Users | Single user now, but the data model is multi-tenant-ready. Integration credentials live in the DB (encrypted), not in env vars |
| Solar valuation | Track **both** a naive €0 cost and the opportunity cost (the feed-in price you gave up) |
| Grid meter | Tibber Pulse (live import/export over the Tibber realtime API) |
| Strategy v1 | Rule-based, with configurable thresholds |
| EcoFlow control | The unofficial app-login/MQTT route is acceptable |
| Devices | 2× STREAM Pro, 1920 Wh each. `capacity_wh` = 1920 per device; usable kWh = capacity × (max SoC − reserve SoC) |

## Architecture

```
 Capacitor app / browser (Nuxt SPA)
            │  HTTPS + bearer token
            ▼
 Nitro server on DO App Platform (1 instance)
   ├─ /api/*            REST for the app
   ├─ collectors        EcoFlow (MQTT), Tibber Pulse (WS), SolarEdge (poll), Tibber prices (poll)
   ├─ ledger job        every minute: samples → 15-min ledger rows
   └─ strategy job      every 15 min and when new prices arrive: plan → device commands
            │
            ▼
        Neon Postgres
```

- **One process does the background work.** App Platform can scale out, so the jobs take a Postgres advisory lock. That way a second instance never sends conflicting battery commands.
- **Capacitor:** `nuxt generate` with `ssr: false` produces static files for Capacitor's `webDir`. The API base URL comes from `runtimeConfig.public.apiBase`. Auth uses opaque bearer session tokens (60 days, stored hashed in `sessions`), not cookies, so the same API works from `capacitor://localhost`. *Implemented:* the token sits in localStorage behind `useAuth()`, to be swapped for Capacitor Preferences.

## Integrations

### EcoFlow (highest risk)
- **Reading:** the official IoT Open API (access key + secret key, HMAC-SHA256 signed requests, `quota` endpoints, plus MQTT push). It needs a developer account at developer-eu.ecoflow.com.
- **Control:** community reports say the official API exposes few or no Stream AC (Pro) setters. The unofficial route signs in with the EcoFlow app account, gets MQTT credentials and sends protobuf `set` messages. Known setters: max charge SoC, min discharge SoC (backup reserve), and scheduled/TOU tasks. On the Stream, a setpoint writes a *whole-day task* rather than flipping a switch. Grid-charge setpoints are reported as unreliable.
- **Design:** a `BatteryDriver` interface (`getState()`, `apply(command, validUntil)`) with an `official` and an `app-login` implementation. The strategy only talks to this interface.
- **Phase 0 spike** proves what actually works on your devices before we build the control loop.

### Tibber
- GraphQL API with a personal token. `priceInfo` for today and tomorrow at **15-minute resolution** (the NL day-ahead market moved to 15-min slots). Tomorrow's prices appear around 13:00 CET.
- Pulse: `liveMeasurement` websocket subscription (grid power import/export, accumulated kWh), roughly every 2 s. We downsample it to 1-minute averages.
- We store `energy` (spot), `tax` and `total` (all-in, including energy tax and VAT) per slot.

### SolarEdge
- Monitoring API with an API key and site ID. **Limit: 300 requests per day per site**, so we poll `currentPowerFlow`/`energyDetails` about every 10 min and back-fill 15-min energy. Live surplus comes from the Pulse anyway, so SolarEdge is mainly for production totals and attribution.

## Data model (multi-tenant-ready)

```
users            id, email, password_hash, created_at
sites            id, user_id, name, timezone, country          -- a household
integrations     id, site_id, provider (ecoflow_official | ecoflow_app | tibber | solaredge),
                 credentials_enc (bytea), credentials_iv, status, last_ok_at, last_error
devices          id, site_id, integration_id, serial, model, capacity_wh, max_charge_w, max_discharge_w
sessions         id, user_id, token_hash, user_agent, expires_at

prices           site_id, slot_start, slot_minutes(15), energy, tax, total, feed_in   (PK site_id+slot_start)
samples          device_id|site_id, ts, kind (battery|grid|solar), power_w, soc, energy_wh   -- 1-min, kept 90 days
ledger           device_id, slot_start,
                 charged_solar_kwh, charged_grid_kwh, discharged_kwh,
                 price_total, price_feed_in,
                 cost_naive, cost_opportunity,          -- cost of energy put in
                 value_discharged,                       -- discharged_kwh × price_total
                 saving_naive, saving_opportunity        -- value minus cost of the energy used
battery_pool     device_id, kwh, cost_naive_eur, cost_opportunity_eur, updated_at   -- running "stock"
strategy_config  site_id, jsonb (thresholds, reserve SoC, η, …)
plans            site_id, slot_start, action (charge_grid | charge_solar | discharge | hold), target_w, reason
commands_log     device_id, ts, command, payload, result
```

- **Credential encryption:** AES-256-GCM per row. One master key `ENCRYPTION_KEY` stays as an App Platform secret (something has to). Everything else (EcoFlow login, keys, Tibber token, SolarEdge key) is entered in the app's settings screen and stored encrypted in Neon.
- Aggregations for hour/day/month are SQL `date_trunc` over `ledger`, in the site's timezone. A materialized daily view can come later if needed.

## Savings ledger: how kWh are valued

The ledger runs every 15 minutes per battery, matching the price slots.

1. **Attribute charging to a source.** With Pulse grid power `P_grid` (+ import, − export) and battery charge power `P_chg`:
   `grid_part = min(P_chg, max(0, P_grid))`, `solar_part = P_chg − grid_part`.
   In words: whatever charging wasn't drawn from the grid came from solar surplus. With two batteries, the split is in proportion to each battery's charge power.
   If a STREAM Pro also reports **direct PV input** power, that part is counted as solar outright and only the AC charge power goes through the formula above.
2. **Cost of energy in:**
   - solar: naive €0. Opportunity cost = `solar_kWh × feed_in_price` (what exporting would have paid).
   - grid: `grid_kWh × total_price` for both measures.
3. **Battery pool (weighted average cost).** Each battery holds a pool of `kWh` and `€ cost`. Charging adds to both. Discharging takes kWh out at the pool's average €/kWh.
4. **Value of energy out:** `discharged_kWh × total_price` at that moment (the import you avoided).
   `saving = value − discharged_kWh × pool_avg_cost`, for naive and opportunity separately.
5. **Losses.** Once a day (and when SoC is 0 % or 100 %) the pool's kWh are reconciled to `SoC × capacity`. The lost kWh disappear but their cost stays in the pool, so round-trip losses automatically show up as a higher cost per kWh.

**Note on net metering (saldering):** until 31 Dec 2026, exported kWh are offset at roughly the full retail price. So this year the honest opportunity price of solar is about the `total` price, and storing solar saves almost nothing. From 1 Jan 2027 it becomes Tibber's feed-in compensation. `feed_in` is therefore a per-slot column computed by a date-aware rule in `strategy_config`, not a constant.

## Strategy v1 (rule-based)

Runs every 15 min and when tomorrow's prices arrive. Both batteries are treated as one pool and power is split between them.

1. **Solar first:** when the Pulse shows export above a threshold, keep the batteries in self-consumption/charge mode (the Stream's own smart-meter mode already does much of this).
2. **Discharge slots:** choose the M most expensive remaining slots of today and tomorrow, with M sized to the usable kWh. Only discharge if `price ≥ pool_avg_cost / η + min_spread`.
3. **Grid-charge slots:** only when the expected solar won't fill the batteries before the next expensive window, choose the N cheapest slots before it, where `price × (1/η) + min_spread ≤ expected discharge price`. η is about 0.85 round trip and configurable.
4. **Reserve:** never go below `reserve_soc` (backup).
5. **Safety:** every command has a `validUntil`. If the server dies, the devices fall back to their own default mode instead of staying stuck in grid-charge. Every command and its result goes to `commands_log`.
6. **Manual override** from the app (e.g. "charge now until 80 %", "hold").

The plan is stored in `plans` and shown in the app on the price chart.

## App screens

- **Login**
- **Dashboard:** both batteries (SoC, power in/out, mode), live flow (solar → house / battery / grid), current price and the next planned action
- **Savings:** hour/day/month/year bars, naive vs opportunity toggle, kWh charged from solar vs grid, kWh discharged
- **Plan:** today's and tomorrow's 15-min price curve with charge/discharge slots, plus manual override
- **Settings:** integrations (enter and test credentials), devices, strategy parameters

## Progress (2026-10-16)

- Phase 1 skeleton done: schema and migrations, auth, encrypted integrations, DO App Platform spec, CORS for Capacitor.
- Collectors: real Tibber prices, Pulse and SolarEdge clients (untested against the live APIs so far), with a fake fallback for each.
- EcoFlow: a **simulated STREAM Pro driver** (`mock`) stands in until phase 0. It reacts to real Pulse/SolarEdge data when connected.
- Ledger, strategy, override and all four screens work. `npm run db:seed` produces 30 days of fake history through the real simulator, strategy and ledger code.

## Build phases

0. **EcoFlow spike:** request developer keys; prove reading *and* control (SoC limits, TOU task, charge/discharge) via the app-login MQTT route on one Stream. Outcome: a confirmed list of commands.
1. **Skeleton:** Nuxt 4, Drizzle with Neon, auth (tokens), encrypted integrations model, deployed to DO App Platform.
2. **Collectors:** Tibber prices and Pulse, SolarEdge, EcoFlow read; Dashboard screen.
3. **Ledger and Savings screen.**
4. **Strategy and control:** Plan screen, override, command log.
5. **Capacitor:** iOS/Android wrapper, secure token storage, push notifications later.

## Open questions

- Are any solar panels wired directly into the STREAM Pro PV inputs, or are both units AC-coupled only (solar via SolarEdge)? Direct PV changes source attribution (see ledger).
- Max AC charge/discharge power per unit as installed (the NL plug-in limit is typically 800 W). This is stored per device, not hardcoded.
- Tibber feed-in terms after 2027 (spot price, spot minus a fee, or something else?), to configure `feed_in`.
- Should grid charging also be allowed when it only pays off after 2027 rules apply, or only on spread?
