# WattsWise public launch: design

Status: draft for review · 2026-10-28

## Intent

WattsWise began as a personal app for one household: two EcoFlow STREAM Pro batteries, SolarEdge solar and a Tibber dynamic contract with a Pulse (see `2026-10-16-energy-app-design.md`). It now becomes a **free, public app in the Apple App Store** for Dutch households with a home battery. Tagline: **"use your watts wisely"**. Name, domain and sender (JER-9): **WattsWise**, `www.wattswise.eu`, `hello@wattswise.eu`.

What we promise a stranger on day one: **see what your home battery actually saves you, and let WattsWise steer it**, meaning charge when power is cheap or solar is free and cover the house when power is expensive.

WattsWise stays a **cloud service**. We host it and the server talks to the brands' cloud APIs. Nothing runs inside the user's home. That limits v1 to brands with a usable cloud API.

The owner (admin) keeps using the experimental integrations (Zeekr cars, the Tibber app login for Tibber EV charging). They can share the household with a second person, their partner, who sees the same thing.

## Goals (v1)

1. Anyone can sign up, connect **Tibber** (prices + Pulse meter), **SolarEdge** (solar) and **EcoFlow STREAM** batteries, see their savings and let WattsWise steer the batteries.
2. Experimental integrations (**Zeekr**, **Tibber app login**) are hidden for everyone unless a user has the *experimental* flag. The flag is off by default and always on for admins.
3. A household can have **more than one member**. Every member sees exactly the same dashboard, savings, plan and devices.
4. An **admin panel** for basic user management and system health.
5. A **public website** with the proposition, how it works, supported devices, privacy policy and terms.
6. The six launch prerequisites:
   1. App Store requirements (account deletion in the app, privacy policy, privacy labels, enough native features to pass guideline 4.2).
   2. A demo household for Apple's reviewer, which also serves as "try before you connect".
   3. Public sign-up, email verification, password reset, onboarding and household invites.
   4. Battery settings per device instead of hardcoded Stream limits.
   5. Legal and privacy: terms, a disclaimer for battery steering, GDPR basics (EU hosting, export, deletion).
   6. Running for many households: job scaling, per-user API limits, error monitoring.

## Non-goals (v1)

- More battery brands (Zendure, Marstek, HomeWizard, Sessy…). The design should make adding one a new driver plus a settings form, but none ship in v1.
- Local or in-home connections (LAN APIs, a home box, the phone talking to devices).
- Price sources other than Tibber, and households without a Tibber Pulse (decided in JER-7). ENTSO-E day-ahead plus a supplier markup is the planned next step.
- Payments, subscriptions or in-app purchases. The app is free.
- Android in the Play Store. The Capacitor setup keeps it possible, but it is out of scope.
- Making Zeekr or the Tibber app login production-grade.
- iOS widgets, Apple Watch, Live Activities.

## Anti-goals (a failure even if it works)

- A public user ever sees, or can call, an experimental integration. Hiding means **enforced on the server**, not only hidden in the UI.
- One household can see or affect another household's data or batteries.
- Battery steering does something the user didn't agree to. Steering is **off (`controlMode = 'manual'`) for a new household** until the user turns it on and accepts the steering disclaimer.
- The owner's current setup breaks or loses history during the migration. Their site, integrations, ledger and samples carry over untouched.
- One slow or failing household delays the minute-by-minute collection or steering of all the others.
- Apple's reviewer can't get past the login screen.

## Current state (what the builder starts from)

- Nuxt 4 + Nitro on DigitalOcean App Platform (`ams`, 1 instance), Neon Postgres via Drizzle. Bearer-token sessions (`server/utils/auth.ts`). Web push via VAPID. Capacitor config exists but there is no iOS project yet (`capacitor.config.ts`, appId `nl.priem.battery`).
- **Data model** (`server/db/schema.ts`): `users` → `sites` (household; `sites.user_id` makes it one owner per site) → `integrations` (per site, encrypted credentials, `provider` is a fixed union: `tibber | solaredge | ecoflow_official | zeekr | tibber_app`), `devices`, `vehicles`, `prices`, `samples`, `ledger`, `solar_production`, `irradiance`.
- **Auth:** `/api/auth/setup` creates the single account, guarded by `NUXT_SETUP_CODE`, and is disabled once any user exists. `requireSite()` resolves the site via `sites.user_id`.
- **Jobs** (`server/utils/jobs.ts`, `nuxt.config.ts` scheduledTasks): each job takes a Postgres advisory lock **inside one transaction** and loops over all sites **sequentially**. `collect` runs every minute. The startup plugin also loops sites sequentially (EcoFlow sync, Pulse websocket, prices, forecast, Zeekr, strategy).
- **Strategy** (`server/lib/types.ts` `StrategyConfig`, `defaultStrategy`): `maxOutputW: 800` and `avgLoadW: 450` are Stream-specific defaults stored per site. `devices` already has `capacity_wh`, `max_charge_w` and `max_discharge_w` per device.
- **Credentials today:** Tibber uses a personal access token. EcoFlow uses the user's own developer access key + secret (developer-eu.ecoflow.com). SolarEdge uses the user's *own* OAuth client ID/secret plus an OAuth sign-in. Of these, SolarEdge has a credit budget (`server/lib/solaredgeBudget.ts`).
- **Experimental surfaces:** `server/providers/zeekr`, `server/services/zeekr.ts`, `server/providers/tibberApp.ts`, `server/services/tibberEv.ts`, the `vehicles` job, `server/api/vehicles/*`, `app/pages/cars.vue`, `CarFigure`, `DepartureSheet`, and the car in the house scene (`EnergyScene`).
- i18n: English and Dutch (`app/i18n`). Both stay.

## Design decisions

### 1. Households, members and roles

- New table `site_members (site_id, user_id, role: 'owner' | 'member', created_at)`, unique on `(site_id, user_id)`. It replaces `sites.user_id` as the source of truth. The migration creates an `owner` row for every existing site, then drops `sites.user_id` (or keeps it unused for one release; builder's call).
- **v1: a user belongs to exactly one household.** `requireSite()` resolves through `site_members`. The data model allows more, the UI doesn't.
- **Members see exactly the same information as the owner.** **Decided (JER-5):** a member can change settings (strategy, feed-in, battery settings, their own push preferences). Only the owner turns steering on or off, accepts the steering disclaimer, manages integrations, manages members, and deletes the household.
- **Invites:** the owner invites by email. A single-use link valid for 7 days lets the invitee sign up or log in and join. If they already have their own (empty) household, joining replaces it after a confirmation. *(my call)*
- The owner can remove a member, and a member can leave. When the owner deletes their account, the whole household and its data are deleted, and members are told in the app and by email. *(my call; ownership transfer is out of scope for v1)*

### 2. Admin and the experimental flag

- `users.role: 'user' | 'admin'` (default `user`) and `users.experimental: boolean` (default `false`). Admins are always treated as experimental. The owner's account is migrated to `admin`.
- One server helper, e.g. `experimentalEnabled(site)`, decides visibility. **Decided (JER-6): per household.** A household is experimental when its owner has the flag or is an admin, and every member then sees the same. It is enforced in:
  - `GET /api/integrations` (the experimental providers are left out of the list)
  - `PUT/DELETE /api/integrations/:provider` (403 for experimental providers)
  - `/api/vehicles/*` (403)
  - the `vehicles` job, the startup plugin's Zeekr call and Tibber EV logic (skip the site)
  - the dashboard payload (no car data)
  - the frontend (hide the cars page, nav entry, car in the scene, settings entries), driven by a `experimental` field on `/api/auth/me`
- Turning the flag off does not delete stored credentials or data. It just stops using them. *(my call)*

### 3. Accounts: sign-up, verification, reset, deletion, export

- **Public sign-up** with email + password replaces `/api/auth/setup`. `NUXT_SETUP_CODE` goes away.
- An admin setting **sign-up mode: `open | closed`** (closed = invite-only) caps hosting cost and load during the launch. *(my call)*
- **Email verification** is required before you can connect integrations. **Password reset** goes by email link. **Rate limiting** applies to login, sign-up and reset (per IP and per email).
- **Transactional email** goes through a hosted provider with an EU option (builder picks, e.g. Postmark or Resend). It sends verification, reset, invite, "household deleted" and admin notices. Templates are in en and nl.
- **Account deletion in the app** (Apple guideline 5.1.1(v)): Settings → Delete account, with a confirmation. An owner deletion deletes the household (cascade already exists via `site_id` FKs). A member deletion just removes the membership and user. Deletion is immediate, with no grace period. *(my call)*
- **Data export** (GDPR): one JSON (or zip of CSVs) download of the household's ledger, samples, prices and settings, never secrets.
- **Email links open the app** *(my call)*: the verify, reset and invite links are Universal Links on the final domain (an `apple-app-site-association` file plus the Associated Domains entitlement) and fall back to the web app. The domain therefore has to be fixed before workstream B starts.
- **Sessions:** the existing bearer-token sessions stay. Add "log out everywhere" on password change. Do not add Sign in with Apple; Apple only requires it when you offer other third-party logins, and we don't.

### 4. Onboarding and generic battery settings

- After verification a new user lands in an **onboarding flow**: name the household → connect Tibber with an active Pulse (**both required in v1, decided in JER-7**; onboarding can't continue without them) → connect EcoFlow (devices are discovered) → connect SolarEdge (optional) → confirm the battery settings → choose *monitor only* or *let WattsWise steer*, accepting the steering disclaimer.
- Every step links to a clear how-to (with screenshots) for getting the credential: the Tibber token, EcoFlow developer keys and the SolarEdge client. These are the highest-friction steps.
- **SolarEdge:** investigate whether WattsWise can register **one** OAuth client for all users, so users only "sign in with SolarEdge". If SolarEdge's terms allow it, do that. Otherwise keep per-user client credentials. *(builder investigates)*
- **EcoFlow:** per-user developer keys stay (there is no app-level alternative in the official API). **This is a gate checked before any other work** *(my call)*: confirm that any EcoFlow customer can get developer keys in reasonable time, and that EcoFlow's developer terms allow a third-party service to use them on the customer's behalf. If either fails, stop and come back to the owner, because the v1 proposition depends on it.
- **Feed-in terms per household** *(my call)*: onboarding asks for the household's feed-in deal (whether netting/saldering still applies, the factor and the fee), prefilled with the current Tibber terms. Netting ends in the Netherlands on 2027-01-01, so the defaults switch to the post-netting values on that date. `defaultStrategy.feedIn` stops being the owner's personal deal.
- **Battery settings per device:** model, capacity, max charge W and max discharge W, prefilled from the EcoFlow model (`devices` already has these columns). The site-level `maxOutputW` is derived from the devices (sum of `max_discharge_w`, capped by the system's AC limit) instead of a hardcoded 800. `avgLoadW` defaults from the Pulse history when present.
- The strategy depends only on the existing driver interface (`BatteryDriver`-style: read state, apply command). The `devices.driver` union is the extension point for future brands. No second brand is built in v1.

### 5. Admin panel

Admin-only routes under `/admin` (server: `requireAdmin()`).
- **Users:** list with email, created, last seen, verified, household, role, experimental flag, and per-integration status (`ok`/`error` + last error). Actions: toggle experimental, make/unmake admin, disable login, delete user (same path as self-deletion), resend verification.
- **Households:** members, devices, control mode, last collect time.
- **System:** sign-up mode toggle; job health per job (last run, duration, sites done/failed); error counts per provider in the last 24 h.
- No impersonation in v1. *(my call)*

### 6. Running for many households

- **Jobs:** stop running the whole site loop inside one transaction. Take a session-level advisory lock (or a short lock + a jobs table) and process sites with **bounded concurrency** (e.g. 5–10 at a time) and a **per-site timeout**, so one stuck household can't stall `collect`. Record per-job and per-site timings for the admin panel.
- **Startup plugin:** the same concurrency treatment, so boot time doesn't grow linearly with households.
- **Long-lived connections:** the Tibber Pulse websockets and EcoFlow MQTT connections are per household. Check Tibber's limits on concurrent websocket subscriptions per app/IP and design reconnect backoff so a Tibber outage doesn't cause a reconnect storm.
- **Per-user API budgets:** the SolarEdge budget logic already exists and stays per site. Add backoff on 429/5xx for every provider.
- **Error monitoring:** a hosted error tracker with an EU region (builder picks, e.g. Sentry EU). It gets server errors and client errors, scrubbed of credentials and emails.
- **Capacity target for v1:** ~200 households on the current single instance (builder may resize). *(my call, a guess to size against)*

### 7. Legal and privacy

- **Pages on the website and linked in the app:** privacy policy, terms of use, steering disclaimer. **The builder writes clear drafts; the owner has them checked before launch.** The texts are not legal advice.
- **The steering disclaimer** says WattsWise sends commands to your battery based on prices and forecasts, you can switch to monitor-only at any time, and WattsWise isn't liable for device behaviour or financial outcomes. Accepting it is stored with a timestamp and version.
- **The terms are accepted at sign-up** and stored with version + timestamp.
- **GDPR:** data stays in the EU (DigitalOcean `ams`; verify that the Neon project's region is in the EU, move it if not). There is a list of processors (DigitalOcean, Neon, email provider, error tracker, Apple for push), export and deletion as above, and retention as the current retention job does.
- **App Store privacy labels** are filled from this list (email, usage data, energy data linked to the user; no tracking, no ads).

### 8. Demo household

- One seeded household, `demo@…`, with two STREAM batteries, solar and a Pulse, **read-only** (all writes return 403; steering never sends commands). *(my call)*
- **The data is synthetic and regenerated daily** by a job: realistic solar, load, prices and battery behaviour for the last ~60 days, so savings and charts look alive. Jobs that talk to providers skip it.
- **Two entry points:** the App Store review notes get the demo credentials, and "Try the demo" sits on the login screen and the website (a session without signing up).

### 9. iOS app

- A Capacitor iOS project. Change the bundle id from `nl.priem.battery` to `app.wattswise.ios` (JER-9). Static build against the production API (`generate:app`, `NUXT_PUBLIC_API_BASE`).
- **Native features to clear guideline 4.2:** native push via APNs (`@capacitor/push-notifications`; the server gets an APNs sender next to web push, and `push_subscriptions` stores the platform), the session token in the Keychain instead of localStorage, a native splash/icon, and haptics on key actions. *(my call for the minimum set)*
- In-app account deletion, links to the privacy policy and terms, and the demo entry.
- Submission assets: screenshots (en + nl), description, keywords, privacy labels, review notes with demo credentials. The `app-store-screenshots` skill can generate the screenshots.
- **Prerequisites the owner handles:** the App Store Connect app record, bundle id and APNs key. The owner already has an Apple Developer Program membership as an **individual** (JER-8).

### 10. Public website

- Pages: home (the proposition, "use your watts wisely", the savings story, screenshots), how it works, supported devices (Tibber, SolarEdge, EcoFlow STREAM, with "more brands coming"), FAQ, privacy, terms, and a sign-up / App Store link. In en and nl.
- **Placement:** the same Nuxt project, with the public pages prerendered and the app behind login. *(my call: simplest to deploy and share i18n and branding; builder may split it out if routing gets awkward with the Capacitor build, which must not include the marketing pages)*
- Brand assets already exist in `public/brand/`.

## Workstreams and order

| # | Workstream | Depends on |
|---|---|---|
| A | Households, members, roles, experimental flag (§1, §2) | n/a |
| B | Accounts: sign-up, verification, reset, invites, deletion, export, email (§3) | A |
| C | Onboarding + battery settings per device (§4) | B |
| D | Admin panel (§5) | A (users list), B (deletion path) |
| E | Running for many households: jobs, monitoring (§6) | can start right after A |
| F | Legal and privacy texts + consent storage (§7) | the texts can start any time; consent storage needs B |
| G | Demo household (§8) | A |
| H | Public website (§10) | F for the legal pages |
| I | iOS app + submission (§9) | B, C, F, G; last |

A goes first and alone, since everything touches `requireSite()`. After that, B, E and G can run in parallel, then C, D, F and H, and I last.

## Constraints

- The owner's existing household, history and credentials must survive every migration. Each migration is tested against a copy of production (a Neon branch).
- No secrets in the client, logs, exports or error reports.
- Keep the current stack: Nuxt 4, Nitro, Drizzle, Neon, DigitalOcean, Capacitor. Match the existing code style (small services, comments explain the why).
- Tests (vitest) for the permission rules (experimental hiding, household isolation, member vs owner), deletion cascades, and job concurrency.

## Left to the builder

The email provider and error tracker (EU regions), the exact table and column names, the job-locking mechanism, the export format, the website's visual design (within the existing brand), the rate-limit numbers, and whether to keep `sites.user_id` for one release.

## Open questions

Tracked as `Decision` issues in Linear (project "WattsWise public launch"). The work that depends on each one stays blocked until it is answered.

1. ~~What can a household member do?~~ **Decided (JER-5):** settings yes; steering, connections and members are owner-only.
2. ~~Experimental flag per user or per household?~~ **Decided (JER-6):** per household, following the owner.
3. ~~Are Tibber and a Tibber Pulse required?~~ **Decided (JER-7):** both are required in v1.
4. ~~Who publishes the app?~~ **Decided (JER-8):** the owner as a private person, with an existing individual Apple developer account. The owner is the data controller in the privacy policy.
5. ~~Name, domain, bundle id and email sender?~~ **Decided (JER-9):** the app is called **WattsWise**, the domain is `www.wattswise.eu`, the bundle id is `app.wattswise.ios`, and email goes out from `hello@wattswise.eu`.
