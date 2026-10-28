import type { Locale } from './types'

/**
 * Texts for the transactional emails. Pure functions so they can be tested without sending anything.
 * Every email has a plain-text and an HTML version; the HTML is one centered card with the WattsWise mark.
 */
export interface EmailVars {
  verify: { url: string }
  reset: { url: string }
  /** Someone signed up with an address that already has an account */
  accountExists: { loginUrl: string; resetUrl: string }
  invite: { url: string; inviter: string; household: string }
  householdDeleted: { household: string }
  adminNotice: { subject: string; body: string }
}
export type EmailTemplate = keyof EmailVars

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

/** One email: a heading, paragraphs, an optional button and a closing note. */
interface Content {
  subject: string
  heading: string
  paragraphs: string[]
  button?: { label: string; url: string }
  note?: string
}

const HOURS = { verify: 48, reset: 1, invite: 7 * 24 }

const CONTENT: { [T in EmailTemplate]: (v: EmailVars[T], locale: Locale) => Content } = {
  verify: ({ url }, l) =>
    l === 'nl'
      ? {
          subject: 'Bevestig je e-mailadres voor WattsWise',
          heading: 'Bevestig je e-mailadres',
          paragraphs: ['Bevestig dat dit jouw adres is. Daarna kun je je batterijen, Tibber en SolarEdge koppelen.'],
          button: { label: 'E-mailadres bevestigen', url },
          note: `De link werkt ${HOURS.verify} uur. Heb je geen WattsWise-account aangemaakt? Dan kun je deze mail negeren.`,
        }
      : {
          subject: 'Confirm your email address for WattsWise',
          heading: 'Confirm your email address',
          paragraphs: ['Confirm this is your address. After that you can connect your batteries, Tibber and SolarEdge.'],
          button: { label: 'Confirm email address', url },
          note: `The link works for ${HOURS.verify} hours. Didn't create a WattsWise account? Then you can ignore this email.`,
        },
  reset: ({ url }, l) =>
    l === 'nl'
      ? {
          subject: 'Nieuw wachtwoord voor WattsWise',
          heading: 'Kies een nieuw wachtwoord',
          paragraphs: ['Iemand vroeg een nieuw wachtwoord aan voor je WattsWise-account.'],
          button: { label: 'Nieuw wachtwoord kiezen', url },
          note: `De link werkt ${HOURS.reset} uur. Heb jij dit niet gevraagd? Dan blijft je wachtwoord zoals het is.`,
        }
      : {
          subject: 'New password for WattsWise',
          heading: 'Choose a new password',
          paragraphs: ['Someone asked for a new password for your WattsWise account.'],
          button: { label: 'Choose a new password', url },
          note: `The link works for ${HOURS.reset} hour. Didn't ask for this? Then your password stays as it is.`,
        },
  accountExists: ({ loginUrl, resetUrl }, l) =>
    l === 'nl'
      ? {
          subject: 'Je hebt al een WattsWise-account',
          heading: 'Je hebt al een account',
          paragraphs: [
            'Iemand probeerde een WattsWise-account aan te maken met dit e-mailadres. Dat account bestaat al, dus er is niets veranderd.',
            `Wachtwoord vergeten? Kies een nieuw via ${resetUrl}`,
          ],
          button: { label: 'Inloggen', url: loginUrl },
          note: 'Was jij dit niet? Dan kun je deze mail negeren.',
        }
      : {
          subject: 'You already have a WattsWise account',
          heading: 'You already have an account',
          paragraphs: [
            'Someone tried to create a WattsWise account with this email address. That account already exists, so nothing changed.',
            `Forgot your password? Choose a new one at ${resetUrl}`,
          ],
          button: { label: 'Log in', url: loginUrl },
          note: "Wasn't this you? Then you can ignore this email.",
        },
  invite: ({ url, inviter, household }, l) =>
    l === 'nl'
      ? {
          subject: `${inviter} nodigt je uit voor ${household} in WattsWise`,
          heading: `Doe mee met ${household}`,
          paragraphs: [`${inviter} nodigt je uit voor het huishouden ${household} in WattsWise. Je ziet dan dezelfde batterijen, het plan en de besparing.`],
          button: { label: 'Uitnodiging bekijken', url },
          note: `De uitnodiging werkt ${HOURS.invite / 24} dagen. Ken je ${inviter} niet? Dan kun je deze mail negeren.`,
        }
      : {
          subject: `${inviter} invites you to ${household} in WattsWise`,
          heading: `Join ${household}`,
          paragraphs: [`${inviter} invites you to the household ${household} in WattsWise. You'll see the same batteries, plan and savings.`],
          button: { label: 'View the invitation', url },
          note: `The invitation works for ${HOURS.invite / 24} days. Don't know ${inviter}? Then you can ignore this email.`,
        },
  householdDeleted: ({ household }, l) =>
    l === 'nl'
      ? {
          subject: `Huishouden ${household} is verwijderd`,
          heading: 'Huishouden verwijderd',
          paragraphs: [
            `Het huishouden ${household} is verwijderd uit WattsWise, met de koppelingen en alle metingen.`,
            'WattsWise stuurt je batterijen niet meer aan. Ze volgen weer hun eigen instellingen in de EcoFlow-app.',
          ],
        }
      : {
          subject: `Household ${household} was deleted`,
          heading: 'Household deleted',
          paragraphs: [
            `The household ${household} was deleted from WattsWise, with its connections and all readings.`,
            'WattsWise no longer steers your batteries. They follow their own settings in the EcoFlow app again.',
          ],
        },
  // Only to the admin, so one language is enough; the locale still picks the frame's texts
  adminNotice: ({ subject, body }) => ({ subject: `[WattsWise] ${subject}`, heading: subject, paragraphs: body.split(/\n{2,}/) }),
}

const FOOTER: Record<Locale, string> = {
  en: 'WattsWise · use your watts wisely · wattswise.eu',
  nl: 'WattsWise · use your watts wisely · wattswise.eu',
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function text(c: Content, locale: Locale): string {
  return [c.heading, '', ...c.paragraphs.flatMap((p) => [p, '']), ...(c.button ? [`${c.button.label}: ${c.button.url}`, ''] : []), ...(c.note ? [c.note, ''] : []), '--', FOOTER[locale]].join('\n')
}

/** Inline styles only: mail clients drop <style> blocks and most CSS. Colors from the app's light theme. */
function html(c: Content, locale: Locale, appUrl: string): string {
  const p = (s: string, style = 'margin:0 0 16px;font-size:16px;line-height:1.5;color:#0f2229') => `<p style="${style}">${esc(s)}</p>`
  const button = c.button
    ? `<p style="margin:24px 0"><a href="${esc(c.button.url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#0f2229;color:#ffffff;font-weight:600;text-decoration:none">${esc(c.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#4a5f67;word-break:break-all">${esc(c.button.url)}</p>`
    : ''
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#e6ecee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#f4f7f8;border-radius:16px">
<tr><td style="padding:28px 28px 8px"><img src="${esc(appUrl)}/icon-192.png" width="40" height="40" alt="WattsWise" style="display:block;border-radius:10px"></td></tr>
<tr><td style="padding:8px 28px 12px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f2229">${esc(c.heading)}</h1>
${c.paragraphs.map((x) => p(x)).join('\n')}
${button}
${c.note ? p(c.note, 'margin:0 0 16px;font-size:14px;line-height:1.5;color:#4a5f67') : ''}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #d5dee1;font-size:12px;color:#4a5f67">${esc(FOOTER[locale])}</td></tr>
</table></td></tr></table>
</body></html>`
}

/** The subject, plain text and HTML of one email. `appUrl` is where the logo is served from. */
export function renderEmail<T extends EmailTemplate>(template: T, vars: EmailVars[T], locale: Locale, appUrl: string): RenderedEmail {
  const c = CONTENT[template](vars, locale)
  return { subject: c.subject, text: text(c, locale), html: html(c, locale, appUrl.replace(/\/$/, '')) }
}
