# Security-rapport WattsWise (vóór livegang)

Datum: 15 november 2026 · Branch: `security/audit-pre-launch` · Takenlijst: [`security-audit.md`](security-audit.md)

Alles is onderzocht op de code in deze repo, lokaal (PGlite, lokale build) en met **alleen-lezen** blikken op de DigitalOcean-appspec en het Neon-project. Er is niets geschreven naar de productiedatabase of de live app, en er zijn geen aanvalstests tegen productie gedaan. Gevonden geheimen staan hieronder zonder hun waarde.

Ernst: 🔴 Kritiek · 🟠 Hoog · 🟡 Middel · 🟢 Laag / OK

## 1. Samenvatting van de stack

| Onderdeel | Wat het is |
|---|---|
| Framework | Nuxt 4 (client-side SPA; de website-pagina's worden vooraf als HTML gerenderd) met een Nitro-server (h3) |
| Database | Neon Postgres 17 (`ecoflow-energy`, eu-central-1), via Drizzle ORM en `postgres.js`. Eén databaserol voor de hele app, geen Supabase/Data API |
| Auth | Eigen implementatie: e-mail + wachtwoord (scrypt), sessies als willekeurige bearer-tokens (SHA-256-hash in `sessions`, 60 dagen). Tokens voor reset, e-mailcheck en uitnodiging zijn eenmalig en kortlevend (`auth_tokens`, `household_invites`) |
| Rollen | `users.role` (`user`/`admin`) en per huishouden `site_members.role` (`owner`/`member`); een gedeeld, alleen-lezen demo-huishouden |
| Hosting | DigitalOcean App Platform (`ecoflow-energy`, ams), 1 instance, deploy vanaf `main`, domein `www.wattswise.eu` (`wattswise.eu` stuurt door) |
| iOS | Capacitor-app; sessietoken in de Keychain (`@aparajita/capacitor-secure-storage`), op het web in `localStorage` |
| Storage | Geen S3/buckets. Deurbelgeluiden (MP3/WAV, max 1 MB) en plattegronden (data-URL) staan in Postgres |
| Geheimen | Server: DO-secrets (`NUXT_DATABASE_URL`, `NUXT_ENCRYPTION_KEY`, SMTP). Koppelingen (EcoFlow, Tibber, Tibber-app, SolarEdge, Zeekr, Hue, Nest, Sonos, ABRP) per huishouden AES-256-GCM-versleuteld in `integrations` |
| Externe diensten | SMTP2GO (mail), Sentry EU (fouten, met scrubbing), Web Push (VAPID) |
| Achtergrondjobs | Nitro scheduled tasks (`collect`, `ledger`, `strategy`, `prices`, `digest`, `vehicles`, `demo`, `retention`) met advisory locks |

**API-routes (85).** Publiek (geen sessie): `auth/login`, `auth/signup`, `auth/demo`, `auth/status`, `auth/reset/*`, `auth/verify`, `invite/details`, `invite/signup`, de OAuth-callbacks (`integrations/:provider/callback`, beschermd met een HMAC-gesigneerde `state`), de Nest Pub/Sub-webhook (`integrations/nest/events`, per huishouden HMAC-token in de URL), `sonos/sounds/play/:file` (192-bit willekeurig token in de naam) en `/.well-known/apple-app-site-association`. Al het andere vraagt `requireUser`, `requireSite`, `requireOwner` of `requireAdmin`; `tests/permissions.test.ts` dwingt dat voor elke nieuwe route af.

**Eindoordeel.** De basis is sterk: autorisatie zit server-side en consequent op `site.id` uit de sessie, queries zijn geparametriseerd, geheimen staan versleuteld, er is rate limiting op alle auth-flows, export en verwijderen van een account bestaan, en het demo-account is centraal alleen-lezen. Er is **geen kritieke** bevinding. De belangrijkste open punten zijn back-ups (6 uur herstelvenster, geen snapshots), het ontbreken van een Content-Security-Policy terwijl het webtoken in `localStorage` staat, en de SolarEdge-callback die zonder `state` een openstaande aanmelding accepteert.

## 2. Bevindingen

| Nr | Ernst | Beschrijving | Locatie | Status |
|---|---|---|---|---|
| B1 | 🟠 | **Back-ups.** Neon-herstelvenster (history retention) is 6 uur en er zijn geen snapshots. Een fout die pas de volgende ochtend opvalt (een kapotte migratie, een verkeerde delete), is niet meer terug te draaien. Een restore is nooit getest | Neon-project `restless-silence-18560926` | Voorstel |
| B2 | 🟠 | **Geen Content-Security-Policy voor scripts.** Het sessietoken staat op het web in `localStorage`; één XSS-lek betekent een gestolen sessie van 60 dagen. Ik vond geen XSS (`v-html` alleen op eigen Markdown, plattegrond-SVG via `<img>`), maar een CSP is de vangnetlaag | `nuxt.config.ts`, `app/composables/useAuth.ts:11` | Deels opgelost (headers), CSP = voorstel |
| B3 | 🟡 | **Security headers ontbraken** (HSTS, nosniff, frame-ancestors/X-Frame-Options, Referrer-Policy, Permissions-Policy) | `server/plugins/securityHeaders.ts` (nieuw) | Opgelost |
| B4 | 🟡 | **SolarEdge-callback zonder `state`.** Als SolarEdge de `state` weglaat, koppelt de callback de code aan "de enige aanmelding die in de laatste 15 minuten is gestart", over alle huishoudens heen. Iemand die dat moment raakt, kan een eigen SolarEdge-code aan andermans huishouden hangen (of andersom). Vereist wel timing en een code voor de juiste client-ID, dus de kans is klein | `server/api/integrations/[provider]/callback.get.ts:33-34`, `server/services/solaredge.ts:146` | Voorstel (auth-flow) |
| B5 | 🟡 | **Field tampering op koppel-instellingen.** `PUT /api/integrations/:provider` voegde `body.meta` ongefilterd samen met de opgeslagen meta. Een eigenaar kon zo serverstatus overschrijven (`pendingAuthUntil`, het SolarEdge-creditlogboek, synchronisatieresultaten) of megabytes aan JSON opslaan | `server/api/integrations/[provider].put.ts:112` | Opgelost (allowlist: alleen `tibber.homeId`) |
| B6 | 🟡 | **Geen grens aan de request-body.** h3's `readBody` leest alles; met 512 MB RAM is één request van honderden MB genoeg om de server plat te leggen | `server/middleware/bodyLimit.ts` (nieuw) | Opgelost (413 boven 4 MB op `Content-Length`); chunked zonder lengte = open, zie B15 |
| B7 | 🟡 | **Geen algemene rate limit op dure endpoints.** Auth, export en uitnodigingen zijn begrensd, maar `push/test`, `sonos/doorbell/test`, `security/:id/stream`, `strategy` (draait de planner), `plan/override` en de Hue-routes niet. Een ingelogde gebruiker kan zo de server en de API-quota van externe diensten belasten | `server/utils/limits.ts` | Voorstel |
| B8 | 🟡 | **Monitoring & alerting.** Sentry ziet 5xx-fouten; mislukte logins, 429's en ongebruikelijk veel requests worden nergens geteld of gemeld. Er is geen uptime-check buiten de DO-healthcheck | `server/plugins/errors.ts` | Voorstel |
| B9 | 🟡 | **Demo-wachtwoord staat als gewone env var** (niet als SECRET) in de DO-appspec, dus leesbaar voor iedereen met toegang tot het DO-account en in elke spec-export. De waarde stond ook in de uitvoer van deze audit | DO-app `ecoflow-energy`, `NUXT_DEMO_PASSWORD` | Voorstel: als SECRET markeren en roteren |
| B10 | 🟡 | **Bewaartermijnen.** Ruwe metingen worden na 60 dagen samengevat, maar verlopen sessies, gebruikte/verlopen tokens, `vehicle_samples`, `commands_log` en `job_runs` blijven voor altijd staan | `server/services/retention.ts` | Voorstel |
| B11 | 🟢 | **Login verried via de responstijd of een adres een account heeft** (scrypt werd overgeslagen als het adres onbekend was) | `server/api/auth/login.post.ts` | Opgelost (dummy-hash) |
| B12 | 🟢 | **Geen maximale wachtwoordlengte** (scrypt over een enorme string kost CPU); e-mail zonder maximale lengte | `server/utils/crypto.ts`, `server/services/setup.ts`, `passwords.ts`, `household.ts` | Opgelost (256 / 254 tekens) |
| B13 | 🟢 | **`powerW` bij een override en `serial` van een batterij** werden niet gevalideerd (negatief, NaN, onbeperkte lengte) | `server/api/plan/override.post.ts`, `server/api/devices/[id].put.ts` | Opgelost |
| B14 | 🟢 | **Dev-mailtransport in productie.** Zonder `NUXT_EMAIL_SMTP_HOST` zou elke mail, met reset- en uitnodigingslinks, in de log belanden. In productie is de host nu gezet, maar een vergeten variabele was genoeg | `server/services/email.ts:57` | Opgelost (weigert in productie) |
| B15 | 🟢 | **Chunked request-bodies** zonder `Content-Length` vallen niet onder B6. DO's load balancer begrenst dit waarschijnlijk zelf, niet geverifieerd | `server/middleware/bodyLimit.ts` | Open |
| B16 | 🟢 | **Host-header in links.** `appBaseUrl` valt zonder `NUXT_APP_URL` terug op `X-Forwarded-Host`, waarmee een aanvaller resetlinks naar een eigen domein zou kunnen laten wijzen. In productie is `NUXT_APP_URL` gezet, dus nu niet uitbuitbaar | `server/utils/appUrl.ts:5` | Voorstel: in productie verplicht maken |
| B17 | 🟢 | **Nest-webhook-URL (met token) zichtbaar voor leden**, niet alleen voor de eigenaar | `server/api/integrations/index.get.ts:33` | Voorstel |
| B18 | 🟢 | **Database openbaar bereikbaar.** Neon accepteert verbindingen van elk IP (geen allowlist, `block_public_connections: false`). Beschermd door wachtwoord + TLS; DO App Platform heeft zonder dedicated egress geen vast IP | Neon-projectinstellingen | Voorstel (bewust accepteren of dedicated egress) |
| B19 | 🟢 | **Eén databaserol voor alles.** De app draait waarschijnlijk met de eigenaarsrol (kan DDL, kan alles droppen). Niet te controleren vanuit de container | `NUXT_DATABASE_URL` | Voorstel: aparte rol voor de app |
| B20 | 🟢 | **Dependencies.** `npm audit`: 2 kritiek en 1 hoog, allemaal in dev-tools (`vitest`/`tinypool`, `node-forge` via de Nuxt-devserver), niet in de productiebundel. 23 middel, waaronder `nuxt` ≤ 4.6.3 en `@sentry/node` ≤ 11.10.0 | `package.json` | Voorstel: zie §4 |
| B21 | 🟢 | **Sessies van 60 dagen zonder rotatie.** Uitloggen, "overal uitloggen", wachtwoord wijzigen en reset maken sessies wel ongeldig, en tokens worden gehasht opgeslagen | `server/utils/auth.ts:6` | OK, overweeg 30 dagen met verlenging |
| B22 | 🟢 | **Gitleaks: 3 treffers, alle drie vals-positief.** Twee zijn het publieke voorbeeld uit de EcoFlow-ontwikkelaarsdocumentatie (`tests/ecoflow.test.ts:13`), één is een testsleutel `0123…` (`tests/zeekr.test.ts:60`). Geen `.env` ooit gecommit; `.gitignore` sluit `.env` uit | git-historie (302 commits) | OK |
| B23 | 🟢 | **IDOR / gebruikersisolatie.** Elke route met een `:id` filtert op `site.id` uit de sessie; ids voor Hue, Nest en Tibber gaan alleen naar de eigen koppeling van het huishouden. Bevestigd met een nieuwe twee-accounts-test | `tests/isolation.test.ts` | OK |
| B24 | 🟢 | **SQL injection.** Alles loopt via Drizzle of `sql\`\`` met parameters; de vier `sql.raw`-plekken gebruiken alleen vaste kolomnamen uit de code. Zoekopdrachten in het adminpaneel escapen `%`/`_` | `server/services/*.ts` | OK |
| B25 | 🟢 | **Admin-routes.** Alle 9 onder `/api/admin` vragen `requireAdmin` (server-side, getest); een admin kan zichzelf geen rol afnemen of uitschakelen; elke wijziging gaat in `admin_audit` | `server/api/admin/**` | OK |
| B26 | 🟢 | **CORS.** Alleen `capacitor://localhost`, `https://localhost`, `http://localhost`; geen `*`, geen credentials-modus (bearer-token, geen cookie) | `server/middleware/cors.ts` | OK |
| B27 | 🟢 | **File uploads.** Geluiden: max 1 MB, type op inhoud (`sniffAudio`), max 10 per huishouden, geserveerd met vast audio-Content-Type en nu `nosniff`. Plattegronden: alleen base64-data-URL van SVG/PNG/JPEG/WebP, getoond via `<img>` (SVG-scripts draaien daar niet) | `server/services/sonos.ts:252`, `server/lib/floors.ts` | OK |
| B28 | 🟢 | **API-responses.** Geen wachtwoord-hashes, tokens of credentials naar de client (`integrations` geeft alleen `configured`/status/meta; `me` geeft eigen e-mail). Leden zien elkaars e-mail binnen het eigen huishouden, wat de bedoeling is | `server/api/**` | OK |
| B29 | 🟢 | **Foutmeldingen.** In productie geen stacktraces naar de client (gecontroleerd op de lokale productiebuild); Sentry scrubt e-mail en tokens (`scrubEvent`) | `server/services/errors.ts` | OK |
| B30 | 🟢 | **AVG-basis.** Export van alle eigen data en direct verwijderen van account + huishouden bestaan, met wachtwoordcheck. Locatie alleen afgerond op 0,1°, van auto's alleen `atHome` per meting | `server/api/account/*` | OK (zie B10 voor termijnen) |

## 3. Doorgevoerde fixes

| Commit | Fix | Bevinding |
|---|---|---|
| `abfca08` | Security headers op elke response (pagina's, statische bestanden, API) | B3, deels B2 |
| `694de46` | Allowlist voor `meta` bij het opslaan van een koppeling | B5 |
| `63e6463` | Validatie van `powerW` bij een override en van `serial` bij een batterij | B13 |
| `e138add` | Login even traag met of zonder account; maximale lengte voor wachtwoord en e-mail | B11, B12 |
| `6694e38` | API-request-bodies boven 4 MB krijgen 413 | B6 |
| `153b84b` | In productie nooit mails (met tokenlinks) in de log | B14 |
| `39a131f` | Twee-accounts-test over de echte route-handlers | B23 (taak 6) |

Gecontroleerd: alle 490 tests groen (1 overgeslagen: de live EcoFlow-test), server-typecheck schoon, `npm run build` slaagt, en op de lokale build gecontroleerd dat de headers op `/` en op statische bestanden staan, dat een body van 5 MB 413 krijgt en dat een vreemde `Origin` geen CORS-header krijgt. Van de isolatietest heb ik nagegaan dat hij faalt zodra een handler zijn `site.id`-filter kwijtraakt.

**Let op na de merge.** HSTS (`max-age=31536000`) zorgt dat browsers een jaar lang alleen https gebruiken voor `www.wattswise.eu`. Dat is de bedoeling, maar is lastig terug te draaien. `includeSubDomains` staat er bewust niet in.

## 4. Voorstellen (niet uitgevoerd)

1. **Back-ups (B1).** In Neon: herstelvenster op 7 dagen zetten (vereist het Launch-plan, dat al actief is) en een dagelijkse snapshot-schedule op `main`. Daarnaast een wekelijkse `pg_dump` naar een plek buiten Neon. Test één keer een restore naar een nieuwe branch en open de app daartegen.
2. **CSP (B2).** Een policy als `default-src 'self'; script-src 'self' 'sha256-<SKY_BOOT>' 'sha256-<SITE_BOOT>'; connect-src 'self' https://*.ingest.de.sentry.io; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:`. Eerst een week als `Content-Security-Policy-Report-Only` met een report-endpoint, dan afdwingen. Hashes van de inline-scripts kunnen bij de build berekend worden.
3. **SolarEdge-callback (B4).** De stateless fallback weghalen, of hem alleen accepteren als de callback in dezelfde browser landt (een korte `HttpOnly`-cookie met de site-id die bij `authorize` wordt gezet). Raakt de auth-flow, daarom niet zelf gedaan.
4. **Algemene rate limit (B7).** Een middleware op `/api/` per sessietoken en per IP (bijvoorbeeld 300 requests per 5 minuten), plus strengere limieten op de testknoppen en het camerastream-endpoint. Eerst meten hoeveel requests de app normaal doet (de dashboard-polling), zodat niemand onterecht een 429 krijgt.
5. **Monitoring (B8).** Mislukte logins en 429's tellen en per uur loggen; boven een drempel een melding (Sentry `captureMessage` of een push naar de admin). Een externe uptime-check op `/api/auth/status`, en Sentry-alerts op nieuwe issues aanzetten.
6. **Bewaartermijnen (B10).** De `retention`-job laten opruimen: verlopen sessies, auth-tokens ouder dan 30 dagen, `vehicle_samples` en `commands_log` na bijvoorbeeld 13 maanden, `job_runs` na 30 dagen. Die termijnen ook in de privacyverklaring zetten.
7. **Dependencies (B20).** `nuxt` naar 4.6.4 (lost de Nuxt-, Nitro- en `seroval`-meldingen op), `@sentry/node` en `@sentry/vue` naar de nieuwste 11.x, `vitest` naar 5.1 (lost de dev-only kritieke meldingen op). Apart in een eigen PR, met een rooktest van de app.
8. **Kleinere punten.** `NUXT_DEMO_PASSWORD` als SECRET markeren en roteren (B9); `appBaseUrl` laten weigeren in productie zonder `NUXT_APP_URL` (B16); de Nest-webhook-URL alleen aan de eigenaar tonen (B17); een aparte databaserol voor de app zonder DDL-rechten, waarbij migraties met de eigenaarsrol draaien (B19).

**Niet van toepassing, met het equivalent hier**

- **Row Level Security (taak 2).** Er is geen Supabase en geen Neon Data API; de browser praat nooit met de database. Het equivalent is dat elke query op `site_id` uit de sessie filtert (`requireSite` → `sessionSite`, `server/services/members.ts:27`), afgedwongen door `tests/permissions.test.ts` en de nieuwe `tests/isolation.test.ts`. Zelf even controleren in de Neon-console dat de Data API uit staat. RLS als tweede laag (met `SET app.site_id` per request) kan, maar is een grote migratie en is niet nodig zolang er geen directe databasetoegang van buiten is.
- **Storage buckets (taak 8).** Er zijn geen buckets. Bestanden staan in Postgres en worden via de API geserveerd: geluiden via een 192-bit token, plattegronden alleen aan het eigen huishouden.
- **Betaalde functies (taak 15 en 20).** Er zijn geen betalingen of credits. De enige "rechten" zijn de rollen admin, owner, member, demo en de experimentele functies, en die worden allemaal server-side bepaald.

## 5. Val je eigen app aan (taak 20)

Gedaan als code-analyse en lokaal (PGlite-test, lokale productiebuild), niet tegen productie.

| Poging | Hoe | Resultaat |
|---|---|---|
| Admin worden | `PUT /api/admin/users/<eigen id>` met `{admin:true}`; `role`/`is_admin` meesturen bij signup of bij wijzigingen | ❌ 403 (`requireAdmin`, getest in `isolation.test.ts`); signup en de wijzig-routes lezen alleen vaste velden (code-analyse) |
| Eigenaar worden van een huishouden als lid | Owner-routes aanroepen | ❌ 403 (`requireOwner`, `permissions.test.ts`) |
| Data van een ander huishouden lezen of wijzigen | Andermans `:id` in devices, vehicles, floors, sounds, members, invites | ❌ 404, B's data onveranderd (`isolation.test.ts`) |
| Andermans huishouden in lijsten zien | Lijst-endpoints en export | ❌ Alleen eigen records; export gaat op `user.id` |
| Uitnodiging kapen | Token raden / hergebruiken | ❌ 256-bit token, gehasht, eenmalig, rate limited |
| Wachtwoord-reset misbruiken | Hergebruik token, gokken, Host-header vervalsen | ❌ Eenmalig, 1 uur, gehasht; host komt in productie uit `NUXT_APP_URL` (B16) |
| Accounts opsporen | Signup, reset en login vergelijken | ❌ Signup en reset antwoorden altijd hetzelfde; login nu ook qua tijd (B11) |
| Demo-account gebruiken om iets te veranderen | Elke niet-GET met een demosessie | ❌ 403 centraal in `assertNotDemo` |
| Andermans OAuth-koppeling overnemen | Vervalste `state` op de callbacks | ❌ HMAC-gesigneerd, 15 min. Uitzondering: SolarEdge zonder `state` (B4) |
| Nest-webhook spoofen | Pub/Sub-push met verzonnen token | ❌ 403, HMAC per huishouden, timing-safe vergeleken |
| Deurbelgeluid van een ander downloaden | Token raden | ❌ 192 bits, alleen `[A-Za-z0-9_-]{32}` |
| XSS via plattegrond of geluid | SVG met script, HTML vermomd als MP3 | ❌ SVG alleen in `<img>`; audio op inhoud gecontroleerd en met `nosniff` |
| Server overbelasten | Body van honderden MB | ❌ Nu 413 (B6). Veel goedkope requests als ingelogde gebruiker kan nog wel (B7) |
| Brute force op login | Veel pogingen | ❌ 20 per IP en 10 per e-mail per 15 min (per instance, er is er één) |

## 6. Top 5 vóór de launch

1. **Back-ups regelen en één keer een restore testen** (B1). Nu is een fout van gisteren niet meer terug te halen.
2. **Deze PR mergen en daarna een CSP uitrollen**, eerst als Report-Only (B2, B3).
3. **De SolarEdge-callback zonder `state` dichtzetten** (B4), nu er meer huishoudens komen.
4. **Een algemene rate limit en basismonitoring** op mislukte logins, 429's en 5xx, met een melding (B7, B8).
5. **Configuratie-hygiëne**: `NUXT_DEMO_PASSWORD` als SECRET markeren en roteren, `nuxt` en Sentry bijwerken, bewaartermijnen voor sessies, tokens en logs (B9, B20, B10).
