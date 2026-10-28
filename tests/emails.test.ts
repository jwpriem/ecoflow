import { afterEach, describe, expect, it, vi } from 'vitest'
import { type EmailTemplate, type EmailVars, renderEmail } from '../server/lib/emails'
import type { Locale } from '../server/lib/types'
import { emailConfig, scrubAddresses, sendEmail } from '../server/services/email'

const VARS: { [T in EmailTemplate]: EmailVars[T] } = {
  verify: { url: 'https://www.wattswise.eu/verify?token=secret-verify' },
  reset: { url: 'https://www.wattswise.eu/reset?token=secret-reset' },
  invite: { url: 'https://www.wattswise.eu/invite?token=secret-invite', inviter: 'jeroen@example.com', household: 'Thuis' },
  householdDeleted: { household: 'Thuis' },
  adminNotice: { subject: 'New sign-up', body: 'Someone signed up.\n\nThe sign-up mode is open.' },
}
const LOCALES: Locale[] = ['en', 'nl']
const cases = (Object.keys(VARS) as EmailTemplate[]).flatMap((t) => LOCALES.map((l) => [t, l] as const))

describe('renderEmail', () => {
  it.each(cases)('%s in %s has a subject, plain text and HTML', (template, locale) => {
    const mail = renderEmail(template, VARS[template] as never, locale, 'https://www.wattswise.eu/')
    expect(mail.subject.length).toBeGreaterThan(5)
    expect(mail.text).toContain('wattswise.eu')
    expect(mail.html).toMatch(/^<!doctype html>/)
    expect(mail.html).toContain(`<html lang="${locale}">`)
    expect(mail.html).toContain('src="https://www.wattswise.eu/icon-192.png"')
    const url = (VARS[template] as { url?: string }).url
    if (url) {
      expect(mail.text).toContain(url)
      expect(mail.html).toContain(`href="${url}"`)
    }
  })

  it('writes Dutch and English', () => {
    expect(renderEmail('verify', VARS.verify, 'nl', '').subject).toMatch(/Bevestig/)
    expect(renderEmail('verify', VARS.verify, 'en', '').subject).toMatch(/Confirm/)
  })

  it('escapes what a user typed', () => {
    const mail = renderEmail('invite', { ...VARS.invite, household: '<script>alert(1)</script>' }, 'en', '')
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
  })
})

describe('sendEmail', () => {
  afterEach(() => vi.restoreAllMocks())

  it('prints the whole email with the dev transport', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const r = await sendEmail('someone@example.com', 'verify', VARS.verify, 'en', emailConfig({}))
    expect(r.ok).toBe(true)
    expect(info.mock.calls[0]![0]).toContain('secret-verify')
  })

  it('never logs the address or the token when sending for real fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Nothing listens on this port: the connection fails straight away
    const config = { ...emailConfig({}), host: '127.0.0.1', port: 1, user: 'u', password: 'p' }
    const r = await sendEmail('someone@example.com', 'reset', VARS.reset, 'nl', config)
    expect(r.ok).toBe(false)
    const logged = JSON.stringify([...info.mock.calls, ...error.mock.calls])
    expect(logged).toContain('[email] reset failed')
    expect(logged).not.toContain('someone@example.com')
    expect(logged).not.toContain('secret-reset')
  })

  it('scrubs addresses from server errors', () => {
    expect(scrubAddresses('550 Recipient <someone@example.com> rejected')).toBe('550 Recipient <<address>> rejected')
  })
})

describe('emailConfig', () => {
  it('reads NUXT_EMAIL_* with sensible defaults', () => {
    expect(emailConfig({})).toMatchObject({ host: '', port: 587, from: 'WattsWise <hello@wattswise.eu>' })
    expect(emailConfig({ NUXT_EMAIL_SMTP_HOST: 'mail-eu.smtp2go.com', NUXT_EMAIL_SMTP_PORT: '2525' })).toMatchObject({ host: 'mail-eu.smtp2go.com', port: 2525 })
  })
})
