import { marked } from 'marked'

/**
 * The how-to guides for getting each connection's keys, one Markdown file per guide and language in
 * content/guides/ (also the source for the website). Bundled with the app, so they work offline and in Capacitor.
 */
export const GUIDES = ['tibber', 'ecoflow', 'solaredge'] as const
export type Guide = (typeof GUIDES)[number]

/** Which guide belongs to a connection card */
export const GUIDE_FOR: Record<string, Guide> = { tibber: 'tibber', ecoflow_official: 'ecoflow', solaredge: 'solaredge' }

const files = import.meta.glob('../../content/guides/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function guideSource(guide: string, locale: 'en' | 'nl'): string | undefined {
  return files[`../../content/guides/${guide}.${locale}.md`] ?? files[`../../content/guides/${guide}.en.md`]
}

/**
 * The guide as HTML. Our own content, so no sanitising; screenshot placeholders ("> Screenshot: …")
 * become a framed box until the real image is added, and links to other sites open in a new tab.
 */
export function guideHtml(guide: string, locale: 'en' | 'nl'): string | undefined {
  const src = guideSource(guide, locale)
  if (!src) return undefined
  return (marked.parse(src, { async: false }) as string)
    .replace(/<blockquote>\s*<p>Screenshot: ([\s\S]*?)<\/p>\s*<\/blockquote>/g, '<figure class="shot" role="img" aria-label="$1"><span>$1</span></figure>')
    .replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"')
}
