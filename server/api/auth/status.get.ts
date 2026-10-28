import { signupMode } from '../../services/setup'

/** Whether the login page offers "Create account". Also the health check: it answers only when the database does. */
export default defineEventHandler(async () => ({ signupOpen: (await signupMode(useDb())) === 'open' }))
