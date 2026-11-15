/**
 * Browsers post Content-Security-Policy violations here (report-uri). No login: the browser sends them on its own.
 * Logged in short, without query strings (they can carry tokens), and rate limited per IP so it can't flood the log.
 */
export default defineEventHandler(async (event) => {
  if (!LIMITS.cspReportIp.hit(clientIp(event))) {
    setResponseStatus(event, 204)
    return null
  }
  const body = (await readBody(event).catch(() => null)) as Record<string, any> | null
  const r = body?.['csp-report'] ?? body ?? {}
  const strip = (v: unknown) => String(v ?? '').split(/[?#]/)[0]!.slice(0, 200)
  console.warn(
    `[csp] ${strip(r['effective-directive'] ?? r['violated-directive'])} blocked=${strip(r['blocked-uri'])} page=${strip(r['document-uri'])} at=${strip(r['source-file'])}:${Number(r['line-number']) || 0}`,
  )
  setResponseStatus(event, 204)
  return null
})
