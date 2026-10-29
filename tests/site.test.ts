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
    expect(robots).toMatch(/^Disallow: \/app$/m)
    expect(robots).not.toMatch(/^Disallow: \/$/m)
  })
})
