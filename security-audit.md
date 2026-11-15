# Security-audit WattsWise: takenlijst

Bevindingen, ernst en voorstellen staan in [`security-report.md`](security-report.md). Afgevinkt = onderzocht en gerapporteerd; dat zegt niet dat er niets meer te doen is.

**Werkwijze:** per taak onderzoek → bevinding → voorstel. Kleine fixes direct met één commit per fix; migraties, RLS, auth-flow en historie alleen voorgesteld. Geen productiedata of live keys aangeraakt.

## Geheimen & configuratie

- [x] 1. API keys verbergen: geen geheimen in frontend of `NUXT_PUBLIC_*` (alleen API-basis en Sentry-DSN, die publiek mag zijn). Koppelingen versleuteld in de DB. Demo-wachtwoord niet als SECRET in DO (B9)
- [x] 4. Git-historie scannen: gitleaks over alle commits, 3 vals-positieven (B22); `.env` in `.gitignore`, nooit gecommit
- [x] 12. Gevoelige logs: geen tokens, wachtwoorden of bodies in logs; dev-mailtransport in productie dichtgezet (B14); geen stacktraces naar de client (B29)

## Toegang & autorisatie

- [x] 2. Row Level Security: n.v.t., geen Supabase/Data API. Equivalent: filter op `site_id` uit de sessie in elke query (zie rapport §4)
- [x] 3. IDOR: alle routes met een id gecontroleerd, alle filteren op het eigen huishouden (B23)
- [x] 5. Admin-routes: alle 9 server-side `requireAdmin`, met audit-log (B25)
- [x] 6. Gebruikersisolatie: twee-accounts-test `tests/isolation.test.ts` (lokaal, PGlite, echte handlers)
- [x] 10. Niet-geauthenticeerde routes: lijst in rapport §1; elke andere route heeft een auth-check (afgedwongen door `tests/permissions.test.ts`)
- [x] 19. Toegang per record: lijsten, export en joins lekken niets van andere huishoudens (B23, B28)

## Invoer & data

- [x] 9. Invoer valideren: handmatige server-side validatie overal; gaten bij `powerW`, `serial`, wachtwoord-/e-maillengte gedicht (B12, B13)
- [x] 11. SQL injection: alles geparametriseerd, `sql.raw` alleen met vaste kolomnamen (B24)
- [x] 13. Field tampering: `meta` bij koppelingen had geen allowlist, nu wel (B5); overige routes kiezen velden expliciet
- [x] 14. File uploads: type op inhoud, maximale grootte, geen uitvoerbare bestanden, `nosniff` (B27)
- [x] 16. API-responses: geen hashes, tokens of credentials naar de client (B28)

## Server & infrastructuur

- [x] 7. Rate limiting: auth, reset, uitnodigingen en export begrensd; dure endpoints nog niet (B7, voorstel)
- [x] 8. Storage buckets: n.v.t., bestanden in Postgres (rapport §4)
- [x] 15. Server-logica: geen prijzen of credits; rollen, demo en experimentele functies server-side bepaald
- [x] 17. Auth-sessies: bearer-tokens gehasht, 60 dagen, uitloggen en reset maken ongeldig; reset-tokens eenmalig, 1 uur; web-token in `localStorage` (B2, B21)
- [x] 18. Dependencies: `npm audit`, geen kritiek of hoog in productie (B20)

## Aanvullend

- [x] 21. HTTPS & security headers: DO dwingt https af; headers toegevoegd (B3); CSP voor scripts = voorstel (B2)
- [x] 22. CORS: allowlist van de Capacitor-origins, geen `*` (B26)
- [x] 23. Backups: 6 uur herstelvenster, geen snapshots, restore nooit getest (B1)
- [x] 24. Privacy / AVG: export en verwijderen aanwezig; bewaartermijnen voor sessies, tokens en logs ontbreken (B10, B30)
- [x] 25. Monitoring & alerting: alleen Sentry op 5xx (B8)

## Afsluitend

- [x] 20. Val je eigen app aan: als code-analyse en lokale test, niet tegen productie (rapport §5)
- [x] Rapport opleveren: [`security-report.md`](security-report.md)

## Tweede ronde (15 november): top 5

- [x] Back-ups: 7 dagen herstelvenster, dagelijkse en wekelijkse snapshots, restore getest
- [x] CSP: report-only uitgerold, afdwingen via `NUXT_CSP_MODE=enforce`
- [x] SolarEdge-callback zonder state gebonden aan de eigen browser
- [x] Algemene rate limit en melding bij mislukte logins en 429's
- [x] Bewaartermijnen, privacybeleid bijgewerkt
- [x] nuxt, Sentry en vitest bijgewerkt
- [ ] Demo-wachtwoord roteren als SECRET in DigitalOcean (Jeroen)
- [ ] CSP afdwingen na een week zonder `[csp]`-meldingen (Jeroen)
