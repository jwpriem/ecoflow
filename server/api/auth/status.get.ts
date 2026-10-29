import { demoUser } from '../../services/demo'
import { signupMode } from '../../services/setup'

/**
 * Whether the login page offers "Create account" and "Try the demo". Also the health check: it answers only
 * when the database does.
 */
export default defineEventHandler(async () => {
  const db = useDb()
  const [mode, demo] = await Promise.all([signupMode(db), demoUser(db)])
  return { signupOpen: mode === 'open', demo: !!demo }
})
