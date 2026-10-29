import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SITE_PAGES, SITE_TEXT, SITE_URL } from '../app/utils/site'

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
})
