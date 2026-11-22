import { describe, expect, it } from 'vitest'
import { legacySettingsPath, visibleSettingsSections } from '../app/utils/settingsSections'

describe('settings sections', () => {
  it('shows cars and Sonos only with the experimental integrations, Sonos only to the owner', () => {
    expect(visibleSettingsSections({ experimental: false, owner: true })).toEqual(['general', 'steering', 'solar', 'connections', 'account'])
    expect(visibleSettingsSections({ experimental: true, owner: true })).toEqual(['general', 'steering', 'solar', 'cars', 'connections', 'sonos', 'account'])
    expect(visibleSettingsSections({ experimental: true, owner: false })).toEqual(['general', 'steering', 'solar', 'cars', 'connections', 'account'])
  })

  it('sends links from before the split to their page', () => {
    expect(legacySettingsPath('#cars', {})).toBe('/settings/cars')
    expect(legacySettingsPath('#doorbell', {})).toBe('/settings/sonos#doorbell')
    expect(legacySettingsPath('', { hue: 'ok' })).toBe('/settings/connections')
    expect(legacySettingsPath('', {})).toBeNull()
  })
})
