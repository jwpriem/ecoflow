import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { guideHtml } from '../app/utils/guides'
import { legalHtml, legalVersion } from '../app/utils/legal'
import { SITE_BOOT, SITE_DOCS, SITE_PAGES, SITE_TEXT, SITE_URL } from '../app/utils/site'
import { STEERING_VERSION, TERMS_VERSION } from '../server/lib/legal'

describe('website', () => {
  it('lists every page in both languages in the sitemap', () => {
    const sitemap = readFileSync('public/sitemap.xml', 'utf8')
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    const pages = Object.values(SITE_PAGES).flatMap((p) => Object.values(p)).map((p) => `${SITE_URL}${p}`)
    expect(locs.sort()).toEqual(pages.sort())
  })

  it('has the same texts in Dutch and English', () => {
    const shape = (v: unknown): unknown => (Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v)
    expect(shape(SITE_TEXT.en)).toEqual(shape(SITE_TEXT.nl))
  })

  it('keeps the app out of search engines but not the website', () => {
    const robots = readFileSync('public/robots.txt', 'utf8')
    const rules = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1]!)
    // Robots rules match by prefix; a trailing $ anchors the end
    const blocked = (path: string) => rules.some((r) => (r.endsWith('$') ? path === r.slice(0, -1) : path.startsWith(r)))
    expect(blocked('/app')).toBe(true)
    expect(blocked('/app/')).toBe(true)
    for (const path of Object.values(SITE_PAGES).flatMap((p) => Object.values(p))) expect(blocked(path), path).toBe(false)
  })

  it('has a page for every legal text and guide, in both languages', () => {
    for (const lang of ['nl', 'en'] as const) {
      for (const doc of SITE_DOCS.legal) expect(legalHtml(doc, lang), `${doc}.${lang}`).toMatch(/^<h1>/)
      for (const doc of SITE_DOCS.guide) expect(guideHtml(doc, lang), `${doc}.${lang}`).toMatch(/^<h1>/)
    }
    for (const doc of [...SITE_DOCS.legal, ...SITE_DOCS.guide]) expect(SITE_PAGES[doc]).toBeDefined()
  })

  it('shows the version users accept as the last-updated date', () => {
    const accepted = { privacy: TERMS_VERSION, terms: TERMS_VERSION, steering: STEERING_VERSION }
    for (const lang of ['nl', 'en'] as const) for (const doc of SITE_DOCS.legal) expect(legalVersion(doc, lang)).toBe(accepted[doc])
  })

  it('sends only the installed app to /app, never a browser visit (logged in or not)', () => {
    const run = (o: { search?: string; token?: string; standalone?: boolean }) => {
      let to: string | undefined
      const location = { search: o.search ?? '', replace: (u: string) => (to = u) }
      const localStorage = { getItem: (k: string) => (k === 'battery.token' ? (o.token ?? null) : null) }
      const matchMedia = () => ({ matches: !!o.standalone })
      new Function('location', 'localStorage', 'matchMedia', 'navigator', SITE_BOOT)(location, localStorage, matchMedia, {})
      return to
    }
    expect(run({})).toBeUndefined()
    expect(run({ token: 'abc' })).toBeUndefined()
    expect(run({ standalone: true })).toBe('/app')
    expect(run({ standalone: true, search: '?site' })).toBeUndefined()
  })
})
