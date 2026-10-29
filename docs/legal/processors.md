# Processors and data locations

*Checked 2026-10-29 for JER-29. This is a working document for the owner and a lawyer, not legal advice. The privacy policy (`content/legal/privacy.*.md`) is written from it.*

## Region check

| What | Region | EU? | Source |
|---|---|---|---|
| Database (Neon project `ecoflow-energy`, `restless-silence-18560926`) | `aws-eu-central-1`, AWS Europe (Frankfurt), Germany | **Yes** | Neon API `list_projects`: `region_id: aws-eu-central-1`, `proxy_host: c-8.eu-central-1.aws.neon.tech`. Region names: https://neon.com/docs/introduction/regions |
| App server (DigitalOcean App Platform, app `ecoflow-energy`) | `ams`, Amsterdam, the Netherlands | **Yes** | `.do/app.yaml` (`region: ams`) and the live app spec. Regions: https://docs.digitalocean.com/products/app-platform/details/availability/ |
| Email (SMTP2GO) | Sending through the EU endpoint `mail-eu.smtp2go.com` | **Yes for sending; storage location to be confirmed** | `.do/app.yaml` (`NUXT_EMAIL_SMTP_HOST`). SMTP2GO's privacy policy says it "may sometimes use third party data processors that are located outside of the European Economic Area" with safeguards: https://www.smtp2go.com/privacy/ |
| Error reports (Sentry) | EU (Frankfurt), ingest host `*.ingest.de.sentry.io` | **Yes** | `NUXT_PUBLIC_SENTRY_DSN` in the live app spec |

**Result: the database and the server are in the EU. No migration is needed.**

Database backups: Neon keeps the project's history for **6 hours** (`history_retention_seconds: 21600`, same API call). After a deletion, the data stays restorable from that history for at most 6 hours. That fills the "backup period" placeholder in the privacy policy.

## Processors (they process personal data for WattsWise)

| Processor | Role | Region | Personal data it handles | DPA / terms |
|---|---|---|---|---|
| **DigitalOcean, LLC** | Runs the app server | Amsterdam (NL) | Everything in transit: requests, IP addresses (memory only, see below), logs | DPA: https://www.digitalocean.com/legal/data-processing-agreement · sub-processors: https://www.digitalocean.com/trust/subprocessors |
| **Neon** (Databricks, Inc. since 2025) | Postgres database | Frankfurt (DE) | Everything WattsWise stores (see "What is stored" below) | Terms and DPA: https://neon.com/platform-terms (neon.com/dpa redirects here) · sub-processors: https://www.databricks.com/legal/databricks-subprocessors |
| **SMTP2GO** | Sends account emails | EU sending endpoint | Recipient email address, email content (verification, reset and invitation links) | Privacy: https://www.smtp2go.com/privacy/ · **Owner: accept or request the DPA in the SMTP2GO account (no public DPA URL found) and confirm where logs are stored** |
| **Sentry** (Functional Software, Inc.) | Error reports | Frankfurt (DE) | Error message and stack, route, household number (`siteId`), browser/OS version. No email, keys, IP, bodies or query strings (`shared/scrub.ts`, `server/services/errors.ts`) | DPA: https://sentry.io/legal/dpa/ · sub-processors: https://sentry.io/legal/subprocessors/ |
| **Push services**: Apple (Web Push and, later, APNs), Google (FCM, Chrome), Mozilla (Firefox) | Deliver notifications | Global | The subscription endpoint, and a message encrypted end to end (RFC 8291, `web-push`); they can't read the text | Apple: https://www.apple.com/legal/privacy/ · these are the user's own device platforms. APNs (iOS app) needs the owner's Apple Developer agreement (JER-11) |

## Data sources the user connects (independent controllers, not WattsWise's processors)

The user gives WattsWise keys to read their own data there. Each service has its own relationship with the user.

| Service | Called from | What WattsWise sends | Their privacy terms |
|---|---|---|---|
| **Tibber** (`api.tibber.com`, Pulse websocket) | `server/providers/tibber.ts`, `server/providers/tibberPulse.ts` | The user's token | https://tibber.com/nl/privacy |
| **EcoFlow** (`api-e.ecoflow.com`, EU MQTT) | `server/providers/ecoflow/` | Access key, signed requests; steering commands when steering is on | https://account.ecoflow.com/agreement/en-eu/PrivacyPolicy.html · https://www.ecoflow.com/eu/data-security-and-privacy |
| **SolarEdge** (`connect.solaredge.com`, `monitoringapi.solaredge.com`) | `server/providers/solaredge.ts` | OAuth client and tokens | https://www.solaredge.com/en/privacy-policy (behind a bot check, couldn't be fetched automatically) |
| *Zeekr, Tibber app* | Experimental, the owner's own household only | — | Not offered to the public (`server/services/experimental.ts`) |

## Other outbound requests

| Service | What it receives | Personal data? | Note |
|---|---|---|---|
| **Open-Meteo** (`api.open-meteo.com`), `server/providers/openMeteo.ts` | One **fixed** coordinate for the solar forecast (`SOLAR_LOCATION` in `server/lib/solarForecast.ts`), from the server's IP | **No.** No user data, and the request comes from the server, not the user's device | Open-Meteo is an independent controller: https://open-meteo.com/en/terms. The free plan is for **non-commercial use** only; switch to a paid plan if WattsWise ever charges. ⚠️ Product gap, not privacy: every household gets the forecast for Waddinxveen (JER-53). |
| ~~Google Fonts~~ | Nothing, since JER-52: Archivo is served from `public/fonts/` (`app/assets/main.css`) | — | Fixed in JER-52. Before that, every visitor's browser loaded the font from Google, sending its IP address (cf. LG München I, 20 Jan 2022, 3 O 17493/20). |

## What is stored (from `server/db/schema.ts`)

- **Account:** email, password hash (scrypt), role, language, verification and disabled timestamps (`users`). Sign-in sessions: token hash, **browser user agent**, last seen, expiry (`sessions`; last seen is shown in the admin panel, `server/services/admin.ts`). One-time link token hashes (`auth_tokens`). Accepted legal versions (`consents`). Admin actions (`admin_audit`).
- **Household:** name, time zone, strategy and feed-in settings, steering mode, onboarding step (`sites`), members and invitations (`site_members`, `household_invites`: the invitee's email).
- **Connections:** keys and tokens **encrypted** with AES-256-GCM (`integrations.credentials_enc`, `server/utils/crypto.ts`), plus non-secret settings such as the Tibber home's name or street address (`integrations.meta`).
- **Energy data:** prices, Pulse meter readings, battery state, solar production, forecasts, plans, commands sent, savings ledgers (`prices`, `samples`, `devices`, `solar_production`, `irradiance`, `plans`, `commands_log`, `ledger`, `solar_ledger`, `battery_pool`). Minute samples are averaged after **60 days** (`server/lib/retention.ts`).
- **Push:** endpoint, keys, topics, language, **user agent** (`push_subscriptions`, `server/api/push/index.put.ts`).
- **Experimental (owner only):** cars with VIN and charge data (`vehicles`, `vehicle_samples`).
- **Not stored:** IP addresses. The login rate limiter keeps them in memory only (`server/utils/limits.ts`). Locations are not stored either.

## Changes made to the privacy policy draft with this check

- Neon: "[EU region: to be confirmed]" → Frankfurt, Germany.
- Backups: "[backup period: to be confirmed]" → 6 hours.
- Device details: now also mention the browser or device type stored with a sign-in or push subscription.

## Owner actions

1. Accept or request SMTP2GO's DPA in the account, and confirm where it stores message logs.
2. ~~Self-host the font~~: done in JER-52.
3. Decide on a plan for Open-Meteo if WattsWise ever charges money.
