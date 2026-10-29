import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { GUIDE_FOR, GUIDES, guideHtml } from '../app/utils/guides'

const dir = new URL('../content/guides/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8')

describe('how-to guides', () => {
  it('has every guide in English and Dutch', () => {
    expect(readdirSync(dir).sort()).toEqual(['ecoflow.en.md', 'ecoflow.nl.md', 'solaredge.en.md', 'solaredge.nl.md', 'tibber.en.md', 'tibber.nl.md'])
  })

  it.each(['tibber', 'ecoflow', 'solaredge'])('%s: both languages have the same steps, screenshots and links', (g) => {
    const shape = (md: string) => ({
      sections: md.match(/^#{1,2} /gm)?.length,
      steps: md.match(/^\d+\. /gm)?.length,
      screenshots: md.match(/^> Screenshot: /gm)?.length,
      links: [...md.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]),
    })
    expect(shape(read(`${g}.nl.md`))).toEqual(shape(read(`${g}.en.md`)))
    expect(shape(read(`${g}.en.md`)).screenshots).toBeGreaterThan(0)
  })

  it('renders to HTML without leftover Markdown', () => {
    for (const f of readdirSync(dir)) {
      const html = marked.parse(read(f), { async: false }) as string
      expect(html).toContain('<h1>')
      expect(html).not.toMatch(/\*\*|\]\(/)
    }
  })

  it('shows screenshot boxes, opens other sites in a new tab, and falls back to English', () => {
    for (const g of GUIDES) {
      const html = guideHtml(g, 'nl')!
      expect(html).toContain('<figure class="shot"')
      expect(html).not.toContain('Screenshot:</')
      expect(html).toMatch(/<a href="https:\/\/developer[^"]+" target="_blank" rel="noopener"/)
    }
    expect(guideHtml('nope', 'nl')).toBeUndefined()
    expect(Object.values(GUIDE_FOR).sort()).toEqual([...GUIDES].sort())
  })
})
