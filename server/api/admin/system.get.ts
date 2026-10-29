import { jobHealth, providerErrors, systemCounts } from '../../services/system'
import { signupMode } from '../../services/setup'

/** Sign-up mode, counts, job health and the connections failing now. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDb()
  const [mode, counts, jobs, errors] = await Promise.all([signupMode(db), systemCounts(db), jobHealth(db), providerErrors(db)])
  const cfg = useRuntimeConfig()
  return { signupMode: mode, jobsEnabled: String(cfg.jobsEnabled) !== 'false', errorReports: !!cfg.public.sentryDsn, counts, jobs, providerErrors: errors }
})
