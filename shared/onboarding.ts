/**
 * The onboarding steps a new household's owner goes through, in order. Tibber with a Pulse and the EcoFlow
 * batteries are required; SolarEdge can be skipped. Used by the server (which checks each step) and the app.
 */
export const ONBOARDING_STEPS = ['household', 'tibber', 'ecoflow', 'solaredge', 'battery', 'control'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const isOnboardingStep = (v: unknown): v is OnboardingStep => ONBOARDING_STEPS.includes(v as OnboardingStep)
