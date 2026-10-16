# ecoflow

Personal energy app for 2× EcoFlow STREAM Pro (1920 Wh each), SolarEdge solar and a Tibber dynamic contract with a Tibber Pulse.

- **Batteries**: live state of both batteries, energy flow, current price and what the plan does next
- **Savings**: a 15-minute ledger of every kWh in and out, with savings per hour, day, week, month and year. Two views: solar stored at €0, and solar stored at the feed-in price you gave up
- **Plan**: today's and tomorrow's 15-minute prices with the charge/discharge plan, plus a manual override
- **Settings**: connect Tibber, SolarEdge and EcoFlow (credentials are encrypted in the database), set battery limits and tune the strategy

Design and reasoning: [`docs/plans/2026-10-16-energy-app-design.md`](docs/plans/2026-10-16-energy-app-design.md).

## What's real and what's fake (for now)

| Part | Status |
|---|---|
| Tibber prices (15 min) and Pulse live meter | **Real** once you add your token in Settings. Without it, fake Dutch-style prices are used |
| SolarEdge | **Real** once you add your API key + site ID. Polled every 6 min (limit is 300 calls/day) |
| EcoFlow STREAM Pro | **Simulated**: two batteries that behave like the real ones (power limits, SoC, losses, modes) and react to your real Pulse/SolarEdge data |
| History | `npm run db:seed` creates 30 days of fake history so the savings screens have something to show |

The batteries are simulated until phase 0 proves which EcoFlow commands actually work on the STREAM Pro (see the design doc).

## Stack

Nuxt 4 (SPA, so Capacitor can wrap it later) · Nitro server with scheduled tasks · Neon Postgres + Drizzle · Chart.js · DigitalOcean App Platform.

Background jobs (`server/tasks`):

| Job | When | What |
|---|---|---|
| `collect` | every minute | grid (Pulse → SolarEdge → fake), solar, simulated batteries → `samples` |
| `ledger` | every 15 min | books finished slots into `ledger` and updates each battery's cost pool |
| `strategy` | every 15 min | rebuilds the plan and sends the current mode to the batteries |
| `prices` | hourly at :05 | Tibber today + tomorrow (falls back to fake prices) |

## Local development

```bash
npm install
cp .env.example .env        # fill in NUXT_DATABASE_URL (Neon or local Postgres) and NUXT_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → NUXT_ENCRYPTION_KEY
npm run db:seed             # creates SEED_EMAIL / SEED_PASSWORD + 2 simulated batteries + 30 days of history
npm run dev                 # http://localhost:3000
```

Without the seed, the first visit to `/login` lets you create the account (only while no user exists).

```bash
npm test          # ledger, strategy, simulator, crypto
npm run typecheck
npm run build
```

Migrations run automatically on server start. After changing `server/db/schema.ts`, run `npm run db:generate` and commit the new file in `server/db/migrations`.

## Deploying to DigitalOcean App Platform

1. Create a Neon project and copy the **pooled** connection string (`…-pooler…`, `sslmode=require`).
2. Create the app from this repo, either in the UI or with `doctl apps create --spec .do/app.yaml`.
3. Set the secrets `NUXT_DATABASE_URL` and `NUXT_ENCRYPTION_KEY`. Keep the encryption key safe: without it the saved credentials can't be decrypted.
4. Deploy, open the app, create your account (or run the seed against Neon from your machine), then add Tibber and SolarEdge in Settings.

Keep one instance: it holds the Pulse websocket and runs the control loop. An advisory lock prevents double work if it ever scales out.

## Capacitor (later)

The UI is a client-side SPA that talks to the API with bearer tokens, and the server allows CORS from `capacitor://localhost`. See `capacitor.config.ts` for the steps. The token storage in `app/composables/useAuth.ts` is the one place to switch to `@capacitor/preferences`.
