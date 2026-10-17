/**
 * Sun position and sky colours for the house scene on the Batteries page.
 * Low-precision solar formulas (good to well under a degree, a minute or two on sunrise),
 * which is plenty for drawing the sky.
 */

/** Waddinxveen, NL: where the house is. */
export const HOME_LOCATION = { name: 'Waddinxveen', lat: 52.035, lon: 4.651 } as const

const RAD = Math.PI / 180
/** Sun's centre at -0.833° = top edge on the horizon after refraction: the official sunrise/sunset. */
const HORIZON = -0.833
const MIN = 60_000

export interface SunPosition {
  /** Degrees above the horizon (negative = below). */
  altitude: number
  /** Degrees from the local meridian: negative in the morning (east), positive in the afternoon (west). */
  hourAngle: number
}

export function sunPosition(date: Date, lat: number = HOME_LOCATION.lat, lon: number = HOME_LOCATION.lon): SunPosition {
  const d = date.getTime() / 86_400_000 - 10957.5 // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD
  const q = 280.459 + 0.98564736 * d
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const e = (23.439 - 0.00000036 * d) * RAD
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24
  const ha = ((((gmst * 15 + lon - ra + 180) % 360) + 360) % 360) - 180
  const altitude = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha * RAD)) / RAD
  return { altitude, hourAngle: ha }
}

/** First sunrise and sunset after `from` (within 24 h), found by stepping 2 minutes and interpolating. */
export function nextSunEvents(from: Date, lat: number = HOME_LOCATION.lat, lon: number = HOME_LOCATION.lon) {
  let sunrise: Date | null = null
  let sunset: Date | null = null
  let t0 = from.getTime()
  let a0 = sunPosition(from, lat, lon).altitude
  for (let m = 2; m <= 24 * 60 && (!sunrise || !sunset); m += 2) {
    const t1 = from.getTime() + m * MIN
    const a1 = sunPosition(new Date(t1), lat, lon).altitude
    if ((a0 - HORIZON) * (a1 - HORIZON) <= 0 && a0 !== a1) {
      const at = new Date(t0 + ((HORIZON - a0) / (a1 - a0)) * (t1 - t0))
      if (a1 > a0) sunrise ??= at
      else sunset ??= at
    }
    t0 = t1
    a0 = a1
  }
  return { sunrise, sunset }
}

type Rgb = [number, number, number]
// Sky gradient (top, horizon) by sun altitude: night → nautical → civil twilight → golden hour → day
const SKY: { alt: number; top: Rgb; horizon: Rgb }[] = [
  { alt: -18, top: [7, 11, 28], horizon: [16, 24, 48] },
  { alt: -10, top: [14, 22, 52], horizon: [52, 52, 96] },
  { alt: -4, top: [36, 54, 104], horizon: [196, 120, 112] },
  { alt: 1, top: [72, 104, 170], horizon: [242, 170, 120] },
  { alt: 8, top: [80, 132, 214], horizon: [178, 204, 226] },
  { alt: 30, top: [74, 132, 222], horizon: [164, 198, 230] },
]

export interface Sky {
  top: string
  horizon: string
  /** 0 in full daylight, 1 in deep night: dims the landscape and lights the house. */
  darkness: number
  stars: number
  moon: number
}

export function skyFor(altitude: number): Sky {
  const a = Math.max(SKY[0]!.alt, Math.min(SKY.at(-1)!.alt, altitude))
  let i = 0
  while (i < SKY.length - 2 && a > SKY[i + 1]!.alt) i++
  const A = SKY[i]!
  const B = SKY[i + 1]!
  const t = Math.max(0, Math.min(1, (a - A.alt) / (B.alt - A.alt)))
  const mix = (x: Rgb, y: Rgb) => `rgb(${x.map((v, k) => Math.round(v + (y[k]! - v) * t)).join(', ')})`
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  return {
    top: mix(A.top, B.top),
    horizon: mix(A.horizon, B.horizon),
    darkness: clamp01((6 - altitude) / 18),
    stars: clamp01((-6 - altitude) / 8),
    moon: clamp01((-4 - altitude) / 6),
  }
}
