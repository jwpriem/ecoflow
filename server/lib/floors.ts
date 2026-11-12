import type { FloorPlacement } from '../db/schema'

/** A plan is an image the browser shows as-is; an SVG in an <img> cannot run scripts */
const PLAN = /^data:image\/(svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
/** Enough for a photo of a drawing; bigger files should be scaled down in the app first */
export const MAX_PLAN_CHARS = 3_000_000
export const MAX_FLOORS = 8
const HUE_ID = /^[0-9a-f-]{36}$/i

/** Check a plan from the app: null removes it, otherwise a base64 data URL of a known image type */
export function checkPlan(plan: unknown): string | null {
  if (plan === null) return null
  if (typeof plan !== 'string' || !PLAN.test(plan)) throw new Error('The plan must be an SVG, PNG, JPEG or WebP image')
  if (plan.length > MAX_PLAN_CHARS) throw new Error('The plan is too large, use an image under 2 MB')
  return plan
}

export function checkFloorName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim().slice(0, 40) : ''
  if (!n) throw new Error('Give the floor a name')
  return n
}

/** Keep only valid placements, one per lamp or group, inside the plan */
export function checkPlacements(list: unknown): FloorPlacement[] {
  if (!Array.isArray(list)) throw new Error('placements must be a list')
  const seen = new Set<string>()
  const out: FloorPlacement[] = []
  for (const p of list.slice(0, 200)) {
    if (!p || (p.kind !== 'light' && p.kind !== 'group') || typeof p.id !== 'string' || !HUE_ID.test(p.id)) continue
    const x = Number(p.x)
    const y = Number(p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const key = `${p.kind}:${p.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000
    out.push({ kind: p.kind, id: p.id, x: clamp(x), y: clamp(y) })
  }
  return out
}
