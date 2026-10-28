import { audit } from '../../services/admin'
import { setSignupMode } from '../../services/setup'

/** Body: { mode: 'open' | 'closed' }. Closed: only an invitation gets someone in. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { mode } = (await readBody<{ mode?: string }>(event)) ?? {}
  if (mode !== 'open' && mode !== 'closed') throw createError({ statusCode: 400, statusMessage: 'Mode must be open or closed' })
  const db = useDb()
  await setSignupMode(db, mode)
  await audit(db, admin.id, 'signup.mode', null, { value: mode })
  return { signupMode: mode }
})
