import nodemailer, { type Transporter } from 'nodemailer'
import { type EmailTemplate, type EmailVars, renderEmail } from '../lib/emails'
import type { Locale } from '../lib/types'

export interface EmailConfig {
  /** Empty: the dev transport, which only prints the email to the console */
  host: string
  port: number
  user: string
  password: string
  from: string
  /** Public URL of the app, for the logo and the links */
  appUrl: string
}

/** From NUXT_EMAIL_* (SMTP2GO, EU region, in production). */
export function emailConfig(env: Record<string, string | undefined> = process.env): EmailConfig {
  return {
    host: env.NUXT_EMAIL_SMTP_HOST ?? '',
    port: Number(env.NUXT_EMAIL_SMTP_PORT) || 587,
    user: env.NUXT_EMAIL_SMTP_USER ?? '',
    password: env.NUXT_EMAIL_SMTP_PASSWORD ?? '',
    from: env.NUXT_EMAIL_FROM || 'WattsWise <hello@wattswise.eu>',
    appUrl: env.NUXT_APP_URL || 'https://www.wattswise.eu',
  }
}

/** SSL from the first byte on SMTP2GO's SSL ports; STARTTLS (required) on the others. */
const SSL_PORTS = [465, 8465, 443]

let transport: { key: string; t: Transporter } | undefined
function transporter(c: EmailConfig): Transporter {
  const key = `${c.host}:${c.port}:${c.user}`
  if (transport?.key !== key) {
    const secure = SSL_PORTS.includes(c.port)
    transport = { key, t: nodemailer.createTransport({ host: c.host, port: c.port, secure, requireTLS: !secure, auth: { user: c.user, pass: c.password } }) }
  }
  return transport.t
}

/** Error texts from a mail server can quote the recipient: keep addresses out of the logs. */
export const scrubAddresses = (s: string) => s.replace(/[^\s<>"'@]+@[^\s<>"']+/g, '<address>')

/**
 * Send one transactional email. Never throws: the caller gets { ok, error } and decides what to tell the user.
 * Logs only the template and the outcome, never the address or the links (they carry tokens),
 * except the dev transport, which prints the whole email so you can click the link locally.
 */
export async function sendEmail<T extends EmailTemplate>(
  to: string,
  template: T,
  vars: EmailVars[T],
  locale: Locale,
  config: EmailConfig = emailConfig(),
): Promise<{ ok: boolean; error?: string }> {
  const mail = renderEmail(template, vars, locale, config.appUrl)
  if (!config.host) {
    console.info(`[email:dev] to ${to}\nSubject: ${mail.subject}\n\n${mail.text}`)
    return { ok: true }
  }
  try {
    await transporter(config).sendMail({ from: config.from, to, subject: mail.subject, text: mail.text, html: mail.html })
    console.info(`[email] sent ${template}`)
    return { ok: true }
  } catch (err) {
    const error = scrubAddresses((err as Error).message)
    console.error(`[email] ${template} failed: ${error}`)
    return { ok: false, error }
  }
}
