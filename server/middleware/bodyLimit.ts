/**
 * Refuse oversized API request bodies before anything reads them. The largest legitimate body is a floor plan
 * (MAX_PLAN_CHARS, 3 MB as a data URL) plus its JSON; a doorbell sound is at most ~1.4 MB in base64.
 * Only Content-Length is checked: a chunked body without it is still read in full (see security-report.md).
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return
  const length = Number(getHeader(event, 'content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw createError({ statusCode: 413, statusMessage: 'Request body too large' })
})
