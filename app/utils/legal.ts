import { pickContent, renderMarkdown } from './markdown'

/**
 * The privacy policy, terms of use and steering disclaimer, in content/legal/ (also the source for the website).
 * Their versions are in server/lib/legal.ts; each file states its version at the top.
 */
export const LEGAL_DOCS = ['privacy', 'terms', 'steering'] as const
export type LegalDoc = (typeof LEGAL_DOCS)[number]

const files = import.meta.glob('../../content/legal/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function legalHtml(doc: string, locale: 'en' | 'nl'): string | undefined {
  const src = pickContent(files, '../../content/legal', doc, locale)
  return src === undefined ? undefined : renderMarkdown(src)
}

/** A text's version from its first lines ("*Version 2026-10-29 · …"); the version is the day it last changed */
export function legalVersion(doc: string, locale: 'en' | 'nl'): string | undefined {
  return pickContent(files, '../../content/legal', doc, locale)?.match(/^\*(?:Version|Versie) (\d{4}-\d{2}-\d{2})\b/m)?.[1]
}
