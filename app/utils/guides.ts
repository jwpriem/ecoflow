import { pickContent, renderMarkdown } from './markdown'

/**
 * The how-to guides for getting each connection's keys, one Markdown file per guide and language in
 * content/guides/ (also the source for the website). Bundled with the app, so they work offline and in Capacitor.
 */
export const GUIDES = ['tibber', 'ecoflow', 'solaredge'] as const
export type Guide = (typeof GUIDES)[number]

/** Which guide belongs to a connection card */
export const GUIDE_FOR: Record<string, Guide> = { tibber: 'tibber', ecoflow_official: 'ecoflow', solaredge: 'solaredge' }

const files = import.meta.glob('../../content/guides/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function guideHtml(guide: string, locale: 'en' | 'nl'): string | undefined {
  const src = pickContent(files, '../../content/guides', guide, locale)
  return src === undefined ? undefined : renderMarkdown(src)
}
