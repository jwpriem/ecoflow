export type SolarCount = 'house' | 'fed_in' | 'both'

const KEY = 'savings.solarCount'

function read(): SolarCount {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'fed_in' || v === 'both' ? v : 'house'
  } catch {
    return 'house'
  }
}

/**
 * Which solar value counts as saved: what the house used straight away (power you did not buy),
 * what was fed in, or both. Stored on this device. House only by default: with netting gone from
 * 2027 feed-in earns little, and direct use is the part solar really saves.
 */
export function useSolarCount() {
  const count = useState<SolarCount>('solar-count', read)
  function setCount(v: SolarCount) {
    count.value = v
    try {
      localStorage.setItem(KEY, v)
    } catch {
      // Private mode or storage blocked: the choice still holds for this session
    }
  }
  /** Solar value of a savings row under the current choice; stored solar only counts when valued at feed-in */
  function solarValue(r: { valueSelfUsed: number; valueExported: number; valueToBattery: number } | null | undefined, storedAtFeedIn = false) {
    if (!r) return 0
    const house = count.value !== 'fed_in' ? r.valueSelfUsed : 0
    const fed = count.value !== 'house' ? r.valueExported : 0
    return house + fed + (storedAtFeedIn ? r.valueToBattery : 0)
  }
  return { count, setCount, solarValue }
}

export const SOLAR_COUNTS = [
  { value: 'house', label: 'Used in the house', short: 'House', help: 'Solar the house used straight away, at the price you did not pay' },
  { value: 'fed_in', label: 'Fed in', short: 'Fed in', help: 'Solar sent to the grid, at the feed-in price' },
  { value: 'both', label: 'Both', short: 'Both', help: 'Used in the house plus fed in' },
] as const
