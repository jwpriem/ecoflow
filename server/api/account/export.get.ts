import { exportChunks } from '../../services/export'

/** Everything WattsWise keeps about the user and their household, as one JSON download. Streamed, never secrets. */
export default defineEventHandler(async (event) => {
  const { user } = await requireSite(event)
  rateLimit([LIMITS.exportUser, String(user.id)])
  const chunks = exportChunks(useDb(), user.id)
  const encoder = new TextEncoder()
  setResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="wattswise-export-${new Date().toISOString().slice(0, 10)}.json"`,
    'cache-control': 'no-store',
  })
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await chunks.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(next.value))
      } catch (err) {
        console.error(`[export] user ${user.id}:`, (err as Error).message)
        controller.error(err)
      }
    },
    cancel: () => void chunks.return(undefined),
  })
})
