/**
 * Colour maths for the Lights tab. Hue lamps take a colour as a CIE xy point and white as a colour temperature in
 * mirek (1,000,000 / kelvin); the screen needs RGB. These are the usual sRGB (D65) conversions, good enough to
 * show a lamp's glow and to turn a picked swatch into xy. The lamp clips xy to its own gamut itself.
 */

export type Rgb = [number, number, number]
export type Xy = { x: number; y: number }

const gammaToLinear = (c: number) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92)
const linearToGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** sRGB 0-255 to a Hue xy point */
export function rgbToXy([r, g, b]: Rgb): Xy {
  const [lr, lg, lb] = [r, g, b].map((c) => gammaToLinear(c / 255)) as Rgb
  const X = lr * 0.4124 + lg * 0.3576 + lb * 0.1805
  const Y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722
  const Z = lr * 0.0193 + lg * 0.1192 + lb * 0.9505
  const sum = X + Y + Z
  // Black has no colour; call it the white point
  if (sum === 0) return { x: 0.3127, y: 0.329 }
  return { x: round4(X / sum), y: round4(Y / sum) }
}

/** A Hue xy point to sRGB 0-255 at full brightness (the brightest channel at 255) */
export function xyToRgb({ x, y }: Xy): Rgb {
  if (y <= 0) return [255, 255, 255]
  const Y = 1
  const X = (Y / y) * x
  const Z = (Y / y) * (1 - x - y)
  let r = X * 3.2406 - Y * 1.5372 - Z * 0.4986
  let g = -X * 0.9689 + Y * 1.8758 + Z * 0.0415
  let b = X * 0.0557 - Y * 0.204 + Z * 1.057
  // Out of the screen's gamut: bring negatives to 0, then scale so the brightest channel is 1
  ;[r, g, b] = [r, g, b].map((c) => Math.max(0, c)) as Rgb
  const max = Math.max(r, g, b, 1e-9)
  return [r, g, b].map((c) => Math.round(clamp01(linearToGamma(c / max)) * 255)) as Rgb
}

/** White of a colour temperature (mirek) as sRGB; Tanner Helland's fit of the black-body curve */
export function mirekToRgb(mirek: number): Rgb {
  const t = 1_000_000 / Math.min(500, Math.max(153, mirek)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c)))) as Rgb
}

export const mirekToKelvin = (mirek: number) => Math.round(1_000_000 / mirek / 100) * 100

export const rgbCss = ([r, g, b]: Rgb, alpha = 1) => (alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`)

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbToHex = (rgb: Rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`

/** What a lamp looks like on screen: its white or colour; null when it is off */
export function lampRgb(l: { on: boolean; mirek: number | null; xy: Xy | null }): Rgb | null {
  if (!l.on) return null
  if (l.mirek != null) return mirekToRgb(l.mirek)
  if (l.xy) return xyToRgb(l.xy)
  // A lamp that only dims: warm white
  return mirekToRgb(370)
}

/** Mix the lamps that are on into one colour for a group's glow */
export function mixRgb(colors: Rgb[]): Rgb | null {
  if (!colors.length) return null
  const sum = colors.reduce((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]] as Rgb, [0, 0, 0] as Rgb)
  return sum.map((v) => Math.round(v / colors.length)) as Rgb
}

/** White tones to pick from, warm to cool, as in the Hue app */
export const WHITE_PRESETS = [
  { key: 'candle', mirek: 454 },
  { key: 'warm', mirek: 370 },
  { key: 'neutral', mirek: 286 },
  { key: 'cool', mirek: 222 },
  { key: 'daylight', mirek: 166 },
] as const

/** Colours to pick from in one tap; any other colour through the colour picker */
export const COLOR_PRESETS: readonly Rgb[] = [
  [255, 64, 32],
  [255, 140, 26],
  [255, 214, 51],
  [120, 220, 80],
  [40, 200, 180],
  [40, 120, 255],
  [120, 70, 255],
  [230, 60, 200],
]

function round4(v: number) {
  return Math.round(v * 10_000) / 10_000
}

/** How a lamp or group glows on screen: its colour, stronger with the brightness; a quiet disc when off */
export function glow(rgb: Rgb | null, brightness: number): Record<string, string> {
  if (!rgb || brightness <= 0) return { background: 'var(--fill)', boxShadow: 'none' }
  const a = 0.35 + 0.65 * Math.min(1, brightness / 100)
  return {
    background: `radial-gradient(circle at 50% 45%, ${rgbCss(rgb.map((c) => Math.round(c + (255 - c) * 0.55)) as Rgb, a)} 0%, ${rgbCss(rgb, a)} 45%, ${rgbCss(rgb, 0.55 * a)} 100%)`,
    boxShadow: `0 0 ${Math.round(6 + 18 * a)}px ${rgbCss(rgb, 0.45 * a)}`,
  }
}

/** The lights in one line for Home: how many are on, in which rooms, and their glow */
export function lightsSummary(state: {
  lights: Array<{ id: string; on: boolean; brightness: number; mirek: number | null; xy: Xy | null }>
  groups: Array<{ kind: 'room' | 'zone'; name: string; lightIds: string[] }>
}): { on: number; total: number; rooms: string[]; rgb: Rgb | null; brightness: number } {
  const lit = state.lights.filter((l) => l.on)
  const ids = new Set(lit.map((l) => l.id))
  return {
    on: lit.length,
    total: state.lights.length,
    // Rooms only: your own groups overlap them and would name the same lamps twice
    rooms: state.groups.filter((g) => g.kind === 'room' && g.lightIds.some((id) => ids.has(id))).map((g) => g.name),
    rgb: mixRgb(lit.map(lampRgb).filter((c): c is Rgb => !!c)),
    brightness: lit.length ? Math.round(lit.reduce((s, l) => s + l.brightness, 0) / lit.length) : 0,
  }
}
