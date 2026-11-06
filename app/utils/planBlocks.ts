/**
 * The plan as a timeline: consecutive quarters with the same action and reason become one block.
 * Blocks run on past midnight, so a night charge from 23:00 to 05:00 stays one block.
 */
export interface PlanSlot {
  slotStart: string
  total: number
  action: string | null
  reason?: string | null
  solarW?: number | null
}

export interface PlanBlock {
  /** Index of the first quarter */
  first: number
  /** Index after the last quarter */
  last: number
  start: Date
  end: Date
  action: string | null
  reason: string
  min: number
  max: number
  /** Highest expected solar in the block, W */
  solarPeakW: number
}

const SLOT = 15 * 60_000

export function buildBlocks(slots: PlanSlot[]): PlanBlock[] {
  const blocks: PlanBlock[] = []
  slots.forEach((s, i) => {
    const start = new Date(s.slotStart)
    const reason = s.reason ?? ''
    const last = blocks[blocks.length - 1]
    if (last && last.action === s.action && last.reason === reason && last.end.getTime() === start.getTime()) {
      last.last = i + 1
      last.end = new Date(start.getTime() + SLOT)
      last.min = Math.min(last.min, s.total)
      last.max = Math.max(last.max, s.total)
      last.solarPeakW = Math.max(last.solarPeakW, s.solarW ?? 0)
    } else {
      blocks.push({ first: i, last: i + 1, start, end: new Date(start.getTime() + SLOT), action: s.action, reason, min: s.total, max: s.total, solarPeakW: s.solarW ?? 0 })
    }
  })
  return blocks
}

/** The block that holds quarter i */
export const blockAt = (blocks: PlanBlock[], i: number) => blocks.findIndex((b) => i >= b.first && i < b.last)

/** Quarters in a block */
export const blockQuarters = (b: PlanBlock) => b.last - b.first

/** Expected solar (kWh) and the price range (EUR/kWh) per local day, keyed by the day's date */
export function daySummaries(slots: PlanSlot[]) {
  const days = new Map<string, { solarKwh: number; min: number; max: number }>()
  for (const s of slots) {
    const d = new Date(s.slotStart)
    const key = localDayKey(d)
    const day = days.get(key) ?? { solarKwh: 0, min: Infinity, max: -Infinity }
    day.solarKwh += (s.solarW ?? 0) / 4000
    day.min = Math.min(day.min, s.total)
    day.max = Math.max(day.max, s.total)
    days.set(key, day)
  }
  return days
}

export const localDayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
