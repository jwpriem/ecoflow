/**
 * Settings, split into pages under /settings/<section>. The account menu (top right) lists them in this order,
 * and /settings shows the same list. Cars and Sonos only exist with the experimental integrations; Sonos is the owner's.
 */
export const SETTINGS_SECTIONS = ['general', 'steering', 'solar', 'cars', 'connections', 'sonos', 'account'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const SETTINGS_ICONS: Record<SettingsSection, string> = {
  general: 'gear',
  steering: 'battery',
  solar: 'sun',
  cars: 'car',
  connections: 'plug',
  sonos: 'speaker',
  account: 'person',
}

export const isSettingsSection = (s: unknown): s is SettingsSection => SETTINGS_SECTIONS.includes(s as SettingsSection)

/** The sections this person sees */
export function visibleSettingsSections(o: { experimental: boolean; owner: boolean }): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => (s !== 'cars' && s !== 'sonos') || (o.experimental && (s === 'cars' || o.owner)))
}

/** Where an old /settings link goes: the hash named a group (#cars, #doorbell), the query came back from a sign-in */
export function legacySettingsPath(hash: string, query: Record<string, unknown>): string | null {
  if (hash === '#cars') return '/settings/cars'
  if (hash === '#doorbell' || hash === '#morning') return `/settings/sonos${hash}`
  if (['solaredge', 'hue', 'nest', 'sonos'].some((k) => typeof query[k] === 'string')) return '/settings/connections'
  return null
}
