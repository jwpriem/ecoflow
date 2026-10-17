# ecoflow

Personal energy app for 2× EcoFlow STREAM Pro (1920 Wh each), SolarEdge solar and a Tibber dynamic contract with a Tibber Pulse.

- **Batteries**: energy flow on top (a clean node view, or a detailed house scene with the real day/night sky over Waddinxveen and where the house's power comes from), live state of both batteries, current price and what the plan does next. The default view is set per device in Settings
- **Savings**: a 15-minute ledger of every kWh in and out, with savings per hour, day, week, month and year. Two views: solar stored at €0, and solar stored at the feed-in price you gave up
- **Plan**: today's and tomorrow's 15-minute prices with the charge/discharge plan, plus a manual override
- **Settings**: connect Tibber, SolarEdge and EcoFlow (credentials are encrypted in the database), set battery limits and tune the strategy

Design and reasoning: [`docs/plans/2026-10-16-energy-app-design.md`](docs/plans/2026-10-16-energy-app-design.md).

## What's real and what's fake (for now)

| Part | Status |
|---|---|
| Tibber prices (15 min) and Pulse live meter | **Real** once you add your token in Settings. Without it, fake Dutch-style prices are used |
| SolarEdge | **Real** once you add a Site Access client ID + secret (Monitoring API v2) and sign in with SolarEdge. Solar production read every 20 min from 05:00 to 22:00: ≤60 credits/day, ~1,860 per month, under the Free tier's 2,000 (hard cap 64/day) |
| EcoFlow STREAM Pro | **Simulated**: two batteries that behave like the real ones (power limits, SoC, losses, modes) and react to your real Pulse/SolarEdge data |
| History | `npm run db:seed` creates 30 days of fake history so the savings screens have something to show |

The batteries are simulated until phase 0 proves which EcoFlow commands actually work on the STREAM Pro (see the design doc).

## Stack

Nuxt 4 (SPA, so Capacitor can wrap it later) · Nitro server with scheduled tasks · Neon Postgres + Drizzle · Chart.js · DigitalOcean App Platform.

Background jobs (`server/tasks`):

| Job | When | What |
|---|---|---|
| `collect` | every minute | grid (Pulse → fake), solar (SolarEdge → fake), simulated batteries → `samples` |
| `ledger` | every 15 min | books finished slots into `ledger` and updates each battery's cost pool |
| `strategy` | every 15 min | rebuilds the plan and sends the current mode to the batteries |
| `prices` | hourly at :05 | Tibber today + tomorrow (falls back to fake prices) |
| `digest` | hourly at :00 | at 21:00 local time: push today's savings |

## Local development

```bash
npm install
cp .env.example .env        # fill in NUXT_DATABASE_URL (Neon or local Postgres) and NUXT_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → NUXT_ENCRYPTION_KEY
npm run db:seed             # creates SEED_EMAIL / SEED_PASSWORD + 2 simulated batteries + 30 days of history
npm run dev                 # http://localhost:3000
```

### Neon branches

The Neon project `ecoflow-energy` has two branches:

- `main`: production, schema only. Point App Platform at its **pooled** connection string. It only fills up with real data from the moment the app runs.
- `dev`: the same schema plus 30 days of seeded demo history (login `demo@example.com`). Use it for local development or a preview deploy.

To re-seed `dev` (or any Neon branch) from a network that only allows HTTPS, add `SEED_NEON_HTTP=1`:

```bash
NUXT_DATABASE_URL=<dev pooled url> SEED_NEON_HTTP=1 SEED_EMAIL=demo@example.com SEED_PASSWORD=… npm run db:seed
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
4. Deploy, open the app, create your account (or run the seed against Neon from your machine), then add Tibber and SolarEdge in Settings. For SolarEdge, create a Site Access application at developer.solaredge.com and register the redirect URI that Settings shows (`<server>/api/integrations/solaredge/callback`; set `NUXT_APP_URL` if it comes out wrong behind a proxy).

Keep one instance: it holds the Pulse websocket and runs the control loop. An advisory lock prevents double work if it ever scales out.

## iPhone app (PWA) and notifications

The app installs as a PWA and gets Web Push notifications, including on iPhone (iOS 16.4 or later):

1. Open the deployed app in **Safari** on the iPhone and log in.
2. Tap **Share → Add to Home Screen**, then open **Battery** from the Home Screen. On iOS, notifications only work from there, not in a Safari tab.
3. Go to **Settings → Notifications → Turn on notifications** and allow them. Use **Send a test notification** to check.

What gets pushed (each can be switched off per device):

| Topic | When |
|---|---|
| Charging & discharging | the plan starts a grid-charge or discharge block (not for your own overrides) |
| Tomorrow's prices | the first time Tibber's prices for tomorrow come in (around 13:00) |
| Connection problems | Tibber or SolarEdge goes from working to failing |
| Daily savings | 21:00 local time |

The VAPID key pair that signs the pushes is generated on first use and stored in the database (private key encrypted with `NUXT_ENCRYPTION_KEY`). To manage it yourself, set `NUXT_VAPID_PUBLIC_KEY` and `NUXT_VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`). Changing the key means every device has to turn notifications on again. Apple wants a contact in the key: it uses the account email unless `NUXT_VAPID_SUBJECT` (`mailto:…` or `https://…`) is set.

Brand: **WattWise** · *Know your energy.* The app icons in `public/` (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon-32.png`) are rendered from `scripts/icon.svg`, and `icon-maskable-512.png` from `scripts/icon-maskable.svg`. The `apple-touch-icon*.png` copies at the root are for the filenames iOS probes there; the page itself inlines `apple-touch-icon.png` as a data URI (see `nuxt.config.ts`) because iOS's Add to Home Screen sheet can fail to load it from a URL and then shows a letter tile (the mark scaled into Android's 80% safe zone). Logo files live in `public/brand/`: the mark on its own, the logo for dark and light backgrounds, and the lockup with tagline. The wordmark is Inter Display SemiBold, converted to outlines.

## Capacitor (later)

The UI is a client-side SPA that talks to the API with bearer tokens, and the server allows CORS from `capacitor://localhost`. See `capacitor.config.ts` for the steps. The token storage in `app/composables/useAuth.ts` is the one place to switch to `@capacitor/preferences`.
