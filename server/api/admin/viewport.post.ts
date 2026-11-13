/** TEMPORARY (see app/plugins/viewport.client.ts): logs how the Home Screen app's viewport looks around a tab switch. */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const body = await readBody<{ ua?: string; samples?: unknown[] }>(event)
  console.log(`[vpdebug] user=${user.id} ua=${String(body?.ua).slice(0, 160)} ${JSON.stringify(body?.samples ?? []).slice(0, 6000)}`)
  return { ok: true }
})
