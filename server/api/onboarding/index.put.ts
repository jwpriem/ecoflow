import { isOnboardingStep } from '../../../shared/onboarding'
import { moveOnboarding } from '../../services/onboarding'

/** Body: { step } (a step or 'done'). The owner moves through onboarding; the server checks each required step. */
export default defineEventHandler(async (event) => {
  const { site } = await requireOwner(event)
  const { step } = await readBody<{ step?: string }>(event)
  if (step !== 'done' && !isOnboardingStep(step)) throw createError({ statusCode: 400, statusMessage: 'Unknown step' })
  const updated = await moveOnboarding(useDb(), site, step)
  return { onboarding: updated.onboarding }
})
