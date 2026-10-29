# App Store privacy label ("App Privacy") answers

*Drafted 2026-10-29 for JER-29 from the code on `main`. Enter these in App Store Connect → App Privacy (JER-48). The terms are Apple's: https://developer.apple.com/app-store/app-privacy-details/. Recheck before every release that adds a data type.*

## The questions up front

- **Do you or your third-party partners collect data from this app?** Yes.
- **Is any data used to track the user?** **No.** There are no ads, no analytics SDKs and no data brokers. Nothing is shared with other companies' apps or websites for advertising. The only third-party code in the app is Sentry, for error reports (`app/plugins/errors.client.ts`).
- **Third-party advertising, developer's advertising or marketing, analytics:** not used for any data type below.

## Data types

"Linked" means connected to the user's account. WattsWise has no anonymous use: everything a user sees belongs to their account and household, so almost everything is linked.

| Apple category → type | Collected? | Linked to user | Purposes | What it is in WattsWise (source) |
|---|---|---|---|---|
| Contact Info → **Email Address** | Yes | Yes | App Functionality | Sign-in and account emails (`users.email`, `server/services/email.ts`). Also the email address of people the owner invites (`household_invites.email`) |
| Identifiers → **User ID** | Yes | Yes | App Functionality | The account and household numbers (`users.id`, `sites.id`) |
| Diagnostics → **Crash Data** | Yes, only when Sentry is on | **Yes** (see note) | App Functionality | Unhandled errors with a stack trace (`server/services/errors.ts`, `app/plugins/errors.client.ts`) |
| Diagnostics → **Other Diagnostic Data** | Yes | Yes | App Functionality | The browser/OS version in error reports. The user agent of each sign-in and push subscription (`sessions.user_agent`, `push_subscriptions.user_agent`) |
| Usage Data → **Product Interaction** | Yes | Yes | App Functionality | When each sign-in was last used, shown to admins (`sessions.last_used_at`, `server/services/admin.ts`). Nothing else about taps or screens is recorded |
| User Content → **Other User Content** | Yes | Yes | App Functionality | Names the user types in: the household name and battery names (`sites.name`, `devices.name`) |
| **Other Data Types** | Yes | Yes | App Functionality | Energy data from the user's own services: Pulse meter readings, battery charge and power, solar production, the plan and savings (`samples`, `devices`, `solar_production`, `ledger`). Plus the keys for Tibber, EcoFlow and SolarEdge, stored encrypted (`integrations.credentials_enc`), and battery serial numbers |

**Note on error reports:** an error report carries no email, IP address or keys (`shared/scrub.ts`). It does carry the household number (`siteId`), and WattsWise's own database can turn that number back into an account. Apple counts that as linked. The other option is to drop `siteId` from reports and answer "Not linked", at the cost of not knowing which household had the problem. **Recommendation: keep `siteId` and answer "Linked".** (This corrects the "not linked" in the JER-36 comment.)

## Not collected

Answer **not collected** for:
- Location (precise and coarse). The solar forecast uses one fixed coordinate (`server/lib/solarForecast.ts`). The app never asks for the device's location.
- Health & Fitness, Financial Info, Sensitive Info, Contacts.
- Photos or Videos, Audio, Gameplay, Customer Support data, Browsing History, Search History.
- Purchases: the app is free, with no in-app purchases.
- Identifiers → Device ID: there is no IDFA or IDFV. Push tokens identify the app install so a notification can be delivered, not the device across apps.
- Advertising Data, Other Usage Data, Performance Data.

## To check again when …

- **The iOS app ships (JER-45/46):** the APNs device token joins the web push endpoint. Apple doesn't list push tokens as a separate type, so the "Identifiers" answer stays the same. Recheck if a native SDK is added (for example Sentry's Cocoa SDK, or a crash reporter that collects device IDs).
- **The demo household (JER-39) ships:** demo visitors have no account. If the demo sends error reports, those are "not linked".
- **Google Fonts:** loading the font from Google sends visitors' IP addresses to Google (see `processors.md`). Self-hosting it before launch keeps these answers true. In the Capacitor app, fonts must be bundled anyway.
- **Paid plans:** Purchases and possibly Financial Info would then apply.
