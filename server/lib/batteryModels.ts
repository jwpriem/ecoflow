/**
 * What WattsWise assumes about a battery when EcoFlow reports its model; the owner can change it per device.
 * The STREAM family as far as known: every unit holds 1.92 kWh, charges at up to 1200 W and delivers up to 800 W,
 * and a STREAM system together feeds at most 800 W into the house (the plug-in limit). Confirm against
 * the models in JER-10 before adding brands or larger units.
 */
export interface BatteryModel {
  capacityWh: number
  maxChargeW: number
  maxDischargeW: number
  /** The most one system of these units delivers to the house together */
  systemOutputW: number
}

const STREAM: BatteryModel = { capacityWh: 1920, maxChargeW: 1200, maxDischargeW: 800, systemOutputW: 800 }

export const BATTERY_MODELS: Record<string, BatteryModel> = {
  'STREAM Ultra': STREAM,
  'STREAM Ultra X': STREAM,
  'STREAM Pro': STREAM,
  'STREAM AC Pro': STREAM,
  'STREAM AC': STREAM,
  'STREAM Max': STREAM,
}

/** The model's values; an unknown model gets the STREAM values, which the owner can then correct. */
export function batteryModel(name: string | null | undefined): BatteryModel {
  return (name && BATTERY_MODELS[name.trim()]) || STREAM
}

/** What the batteries can deliver to the house together: their own limits added up, capped by the system's. */
export function derivedMaxOutputW(devs: { model: string; maxDischargeW: number }[], fallback: number): number {
  if (!devs.length) return fallback
  const sum = devs.reduce((s, d) => s + d.maxDischargeW, 0)
  const cap = Math.max(...devs.map((d) => batteryModel(d.model).systemOutputW))
  return Math.min(sum, cap)
}
