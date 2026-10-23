<template>
  <div ref="wrap" class="strip" :class="{ drawn }" @pointermove="hover" @pointerleave="tip = null" @pointerdown="hover">
    <svg v-if="w" :width="w" :height="H" role="img" :aria-label="aria">
      <!-- charge level: last 12 h solid, the plan's projection dotted -->
      <g class="level">
        <line v-for="t in [0, 1]" :key="t" :x1="0" :x2="w - PR" :y1="ly(t)" :y2="ly(t)" class="gl" />
        <text :x="w - PR + 6" :y="ly(1) + 4">100%</text>
        <g v-if="reserve > 0">
          <line :x1="0" :x2="w - PR" :y1="ly(reserve)" :y2="ly(reserve)" class="reserve" />
          <text :x="w - PR + 6" :y="ly(reserve) + 4">{{ Math.round(reserve * 100) }}%</text>
        </g>
        <path v-for="(seg, i) in histSegs" :key="i" :d="line(seg)" class="hist" pathLength="1" />
        <path v-if="forecast.length > 1" :d="line(forecast)" class="fore" />
      </g>

      <!-- price per 15 minutes; the color is what the plan does in that slot -->
      <g class="prices">
        <line :x1="0" :x2="w - PR" :y1="py(0)" :y2="py(0)" class="base" />
        <rect
          v-for="(b, i) in bars" :key="b.t" :x="b.x" :width="bw" :y="Math.min(b.y, py(0))" :height="Math.max(1, Math.abs(py(0) - b.y))"
          :fill="b.color" :class="{ past: b.past }" :style="{ transitionDelay: `${i * 6}ms` }"
        />
        <text :x="w - PR + 6" :y="py(maxP) + 4">{{ cents(maxP) }}</text>
        <text :x="w - PR + 6" :y="py(0) + 4">{{ minP < 0 ? '0' : cents(minP > 0 ? 0 : minP) }}</text>
      </g>

      <!-- now runs through both -->
      <line :x1="xNow" :x2="xNow" :y1="LT - 4" :y2="PB" class="now" />
      <circle :cx="xNow" :cy="ly(socNow)" r="4" class="now-dot" />

      <g class="axis">
        <text v-for="t in ticks" :key="t.x" :x="t.x" :y="H - 2" text-anchor="middle">{{ t.label }}</text>
        <text :x="xNow" :y="H - 2" text-anchor="middle" class="axis-now">{{ m.common.now }}</text>
      </g>

      <g v-if="tip">
        <line :x1="tip.x" :x2="tip.x" :y1="LT" :y2="PB" class="cross" />
      </g>
    </svg>

    <div v-if="tip" class="tooltip" :style="{ left: `${Math.min(Math.max(tip.x, 74), w - 74)}px` }">
      <div class="t-time">{{ tip.time }}</div>
      <div v-if="tip.price != null" class="t-price">{{ cents(tip.price) }} {{ m.common.perKwh }}</div>
      <div v-if="tip.action" class="t-act"><i :style="{ background: ACTION[tip.action]?.color }" />{{ m.mode[tip.action] }}</div>
      <div v-if="tip.soc != null" class="t-soc">{{ m.strip.batteries(Math.round(tip.soc * 100)) }}</div>
    </div>

    <ul class="legend">
      <li v-for="a in presentActions" :key="a"><i :style="{ background: ACTION[a]!.color }" />{{ m.mode[a] }}</li>
      <li><i class="ln" />{{ m.strip.chargeLevel }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
interface Pt { ts: string | Date; soc: number }
interface Slot { slotStart: string; total: number; action: string | null }
const props = defineProps<{ slots: Slot[]; history: Pt[]; forecast: Pt[]; now: string; socNow: number; reserve: number }>()

const { m } = useLocale()
const ACTION: Record<string, { color: string }> = {
  charge_grid: { color: 'var(--cheap)' },
  discharge: { color: 'var(--dear)' },
  self_use: { color: 'var(--own)' },
  solar_only: { color: 'var(--hold)' },
}

// Charge level panel on top, price panel below, shared time axis
const LT = 8
const LH = 64
const GAP = 18
const PT = LT + LH + GAP
const PH = 84
const PB = PT + PH
const H = PB + 22
const PR = 40
const SPAN = 12 * 3600_000
const SLOT = 15 * 60_000

const wrap = ref<HTMLElement>()
const w = ref(0)
const drawn = ref(false)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => (w.value = Math.round(e!.contentRect.width)))
  ro.observe(wrap.value!)
  requestAnimationFrame(() => requestAnimationFrame(() => (drawn.value = true)))
})
onBeforeUnmount(() => ro?.disconnect())

const ms = (v: string | Date) => new Date(v).getTime()
const tNow = computed(() => ms(props.now))
const t0 = computed(() => tNow.value - SPAN)
const t1 = computed(() => tNow.value + SPAN)
const x = (t: number) => ((t - t0.value) / (t1.value - t0.value)) * (w.value - PR)
const xNow = computed(() => x(tNow.value))
const ly = (soc: number) => LT + (1 - Math.min(1, Math.max(0, soc))) * LH

const inWindow = computed(() => props.slots.filter((s) => ms(s.slotStart) + SLOT > t0.value && ms(s.slotStart) < t1.value))
const maxP = computed(() => Math.max(0.01, ...inWindow.value.map((s) => s.total)))
const minP = computed(() => Math.min(0, ...inWindow.value.map((s) => s.total)))
const py = (p: number) => PT + ((maxP.value - p) / (maxP.value - minP.value)) * PH
const bw = computed(() => Math.max(1, x(t0.value + SLOT) - x(t0.value) - 1))
const cents = (p: number) => `${Math.round(p * 100)} ct`

const bars = computed(() =>
  inWindow.value.map((s) => {
    const t = ms(s.slotStart)
    return {
      t,
      x: x(Math.max(t, t0.value)),
      y: py(s.total),
      past: t + SLOT <= tNow.value,
      color: s.action ? (ACTION[s.action]?.color ?? 'var(--hold)') : 'var(--fill)',
    }
  }),
)
const presentActions = computed(() => [...new Set(inWindow.value.map((s) => s.action).filter((a): a is string => !!a && !!ACTION[a]))])

// Break the history line where samples are missing for more than 30 minutes
const histSegs = computed(() => {
  const pts = props.history.filter((p) => ms(p.ts) >= t0.value).concat([{ ts: props.now, soc: props.socNow }])
  const segs: Pt[][] = []
  let cur: Pt[] = []
  for (const p of pts) {
    if (cur.length && ms(p.ts) - ms(cur[cur.length - 1]!.ts) > 30 * 60_000) {
      if (cur.length > 1) segs.push(cur)
      cur = []
    }
    cur.push(p)
  }
  if (cur.length > 1) segs.push(cur)
  return segs
})
const forecast = computed(() => props.forecast.filter((p) => ms(p.ts) <= t1.value))
const line = (seg: Pt[]) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(ms(p.ts)).toFixed(1)},${ly(p.soc).toFixed(1)}`).join('')

const ticks = computed(() => {
  const out: { x: number; label: string }[] = []
  const step = w.value < 480 ? 6 : 3
  const start = new Date(t0.value)
  start.setMinutes(0, 0, 0)
  for (let t = start.getTime() + 3600_000; t < t1.value; t += 3600_000) {
    const h = new Date(t).getHours()
    if (h % step !== 0) continue
    const xx = x(t)
    if (Math.abs(xx - xNow.value) < 30 || xx < 16 || xx > w.value - PR - 16) continue
    out.push({ x: xx, label: `${String(h).padStart(2, '0')}:00` })
  }
  return out
})

const tip = ref<{ x: number; time: string; price: number | null; action: string | null; soc: number | null } | null>(null)
function hover(e: PointerEvent) {
  const rect = wrap.value!.getBoundingClientRect()
  const px = Math.min(Math.max(0, e.clientX - rect.left), w.value - PR)
  const t = t0.value + (px / (w.value - PR)) * (t1.value - t0.value)
  const slot = inWindow.value.find((s) => t >= ms(s.slotStart) && t < ms(s.slotStart) + SLOT) ?? null
  const pts = [...props.history, ...props.forecast]
  let soc: number | null = null
  let best = Infinity
  for (const p of pts) {
    const d = Math.abs(ms(p.ts) - t)
    if (d < best && d < 30 * 60_000) (best = d), (soc = p.soc)
  }
  const at = slot ? ms(slot.slotStart) : t
  tip.value = {
    x: slot ? x(at) + bw.value / 2 : px,
    time: new Date(at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) + (slot ? `–${new Date(at + SLOT).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : ''),
    price: slot?.total ?? null,
    action: slot?.action ?? null,
    soc,
  }
}

const aria = computed(() => {
  const cheapest = [...inWindow.value].filter((s) => ms(s.slotStart) >= tNow.value - SLOT).sort((a, b) => a.total - b.total)[0]
  const end = forecast.value.at(-1)
  const cheapT = cheapest ? new Date(cheapest.slotStart).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : null
  return m.value.strip.aria(Math.round(props.socNow * 100), end ? Math.round(end.soc * 100) : null, cheapT, cheapest ? cents(cheapest.total) : null)
})
</script>

<style scoped>
.strip { position: relative; touch-action: pan-y; user-select: none; }
svg { display: block; overflow: visible; }
text { fill: var(--muted); font-size: 12px; font-stretch: 85%; font-variant-numeric: tabular-nums; }
.gl { stroke: var(--grid); }
.reserve { stroke: var(--text-2); stroke-dasharray: 2 4; stroke-opacity: 0.6; }
.hist { fill: none; stroke: var(--text); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
.drawn .hist { stroke-dashoffset: 0; transition: stroke-dashoffset 1.1s var(--ease-out); }
.fore { fill: none; stroke: var(--text); stroke-width: 2; stroke-dasharray: 0.5 5; stroke-linecap: round; opacity: 0; }
.drawn .fore { opacity: 0.75; transition: opacity 0.5s 0.9s; }
.base { stroke: var(--rule); }
.prices rect { transform-box: fill-box; transform-origin: bottom; transform: scaleY(0); }
.drawn .prices rect { transform: scaleY(1); transition: transform 0.5s var(--ease-out); }
.prices rect.past { opacity: 0.32; }
.now { stroke: var(--text); stroke-width: 1.5; }
.now-dot { fill: var(--text); stroke: var(--bg); stroke-width: 2; }
.axis-now { fill: var(--text); font-weight: 600; }
.cross { stroke: var(--text-2); stroke-dasharray: 1 3; }
.tooltip {
  position: absolute; top: 0; transform: translate(-50%, calc(-100% - 6px)); pointer-events: none;
  background: var(--text); color: var(--bg); border-radius: 6px; padding: 8px 11px; min-width: 128px;
  font-size: 13px; line-height: 1.35; font-variant-numeric: tabular-nums;
}
.t-time { font-weight: 600; font-stretch: 88%; }
.t-act { display: flex; gap: 6px; align-items: center; }
.t-act i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 12px 0 0; padding: 0; font-size: 13px; color: var(--text-2); }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 2px; }
.legend i.ln { height: 2px; border-radius: 0; background: var(--text); }
</style>
