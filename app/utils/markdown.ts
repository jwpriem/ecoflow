import { marked } from 'marked'

/**
 * Our own Markdown (content/) as HTML, so no sanitising. Screenshot placeholders ("> Screenshot: …") become a
 * framed box until the real image is added, and links to other sites open in a new tab.
 */
export function renderMarkdown(src: string): string {
  return (marked.parse(src, { async: false }) as string)
    .replace(/<blockquote>\s*<p>Screenshot: ([\s\S]*?)<\/p>\s*<\/blockquote>/g, '<figure class="shot" role="img" aria-label="$1"><span>$1</span></figure>')
    .replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"')
}

/** The file for a name and language from a glob of content files, falling back to English */
export function pickContent(files: Record<string, string>, dir: string, name: string, locale: 'en' | 'nl'): string | undefined {
  return files[`${dir}/${name}.${locale}.md`] ?? files[`${dir}/${name}.en.md`]
}
