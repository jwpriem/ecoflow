import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { legalHtml, LEGAL_DOCS } from '../app/utils/legal'
import { STEERING_VERSION, TERMS_VERSION } from '../server/lib/legal'

const dir = new URL('../content/legal/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8')
const VERSION: Record<string, string> = { privacy: TERMS_VERSION, terms: TERMS_VERSION, steering: STEERING_VERSION }

describe('legal texts', () => {
  it('has the privacy policy, terms and steering disclaimer in English and Dutch', () => {
    expect(readdirSync(dir).sort()).toEqual(LEGAL_DOCS.flatMap((d) => [`${d}.en.md`, `${d}.nl.md`]).sort())
  })

  it.each(LEGAL_DOCS)('%s: states the version users accept, with the same sections in both languages', (doc) => {
    const en = read(`${doc}.en.md`)
    const nl = read(`${doc}.nl.md`)
    expect(en).toContain(`*Version ${VERSION[doc]} `)
    expect(nl).toContain(`*Versie ${VERSION[doc]} `)
    const sections = (md: string) => md.match(/^#{1,2} /gm)?.length
    expect(sections(nl)).toBe(sections(en))
    // The same list items (in the privacy policy: one per kind of data) in both
    expect(nl.match(/^- /gm)?.length).toBe(en.match(/^- /gm)?.length)
  })

  it('matches what the code does', () => {
    const privacy = read('privacy.en.md')
    // server/lib/retention.ts RAW_DAYS, server/utils/auth.ts SESSION_DAYS
    expect(privacy).toContain('**60 days**')
    expect(privacy).toContain('expire after 60 days')
    for (const p of ['DigitalOcean', 'Neon', 'SMTP2GO', 'Sentry']) expect(privacy).toContain(p)
    expect(read('steering.en.md')).toContain('Self-Powered mode')
  })

  it('renders, with every kind of data and its legal basis', () => {
    expect(legalHtml('privacy', 'nl')!.match(/<em>Grondslag: /g)).toHaveLength(8)
    expect(legalHtml('privacy', 'en')).not.toMatch(/\*\*/)
    expect(legalHtml('steering', 'en')).toContain('<h1>Letting WattsWise steer your batteries</h1>')
    expect(legalHtml('nope', 'en')).toBeUndefined()
  })
})
