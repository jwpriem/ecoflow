import { describe, expect, it } from 'vitest'
import { parseGridRewards } from '../server/providers/tibberApp'

describe('Tibber Grid Rewards', () => {
  it('reads the amounts, the state and the car', () => {
    const r = parseGridRewards({
      homeId: 'h1',
      state: { __typename: 'GridRewardDelivering', reason: 'FrequencyRegulation' },
      rewardCurrency: 'EUR',
      rewardCurrentMonth: 4.12,
      rewardAllTime: 37.5,
      flexDevices: [
        {
          __typename: 'GridRewardVehicle', kind: 'vehicle', vehicleId: 'v1', shortName: '001', make: 'Zeekr',
          isPluggedIn: true, isSmartChargingEnabled: true, state: { __typename: 'GridRewardAvailable', kind: 'x' },
        },
      ],
    })
    expect(r).toEqual({
      state: 'delivering',
      reasons: ['FrequencyRegulation'],
      currency: 'EUR',
      currentMonth: 4.12,
      allTime: 37.5,
      devices: [{ id: 'v1', name: 'Zeekr 001', kind: 'vehicle', pluggedIn: true, smart: true, state: 'available', reasons: [] }],
    })
  })

  it('keeps why it is unavailable, and is null without Grid Rewards', () => {
    const r = parseGridRewards({ state: { __typename: 'GridRewardUnavailable', reasons: ['VehicleNotPluggedIn'] }, rewardCurrentMonth: null })
    expect(r?.state).toBe('unavailable')
    expect(r?.reasons).toEqual(['VehicleNotPluggedIn'])
    expect(r?.currentMonth).toBeNull()
    expect(parseGridRewards(null)).toBeNull()
  })
})
