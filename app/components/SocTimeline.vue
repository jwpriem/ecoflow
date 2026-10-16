<template>
  <div ref="wrap" class="timeline" @pointermove="hover" @pointerleave="tip = null" @pointerdown="hover">
    <svg v-if="w" :width="w" :height="H" role="img" :aria-label="aria">
      <defs>
        <linearGradient id="soc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--sys-green)" stop-opacity="0.38" />
          <stop offset="100%" stop-color="var(--sys-green)" stop-opacity="0" />
        </linearGradient>
        <clipPath id="soc-clip"><rect :x="PL" y="0" :width="Math.max(0, xNow - PL)" :height="H" /></clipPath>
      </defs>

      <!-- recessive grid -->
      <g class="gridlines">
        <g v-for="t in [0, 0.5, 1]" :key="t">
          <line :x1="PL" :x2="w - PR" :y1="y(t)" :y2="y(t)" />
          <text :x="w - PR + 6" :y="y(t) + 4">{{ t * 100 }}%</text>
        </g>
      </g>
      <g v-if="reserve > 0" class="reserve">
        <line :x1="PL" :x2="w - PR" :y1="y(reserve)" :y2="y(reserve)" />
        <text :x="PL + 2" :y="y(reserve) - 5">Reserve {{ Math.round(reserve * 100) }}%</text>
      </g>

      <!-- future half sits on a slightly lifted surface -->
      <rect :x="xNow" :y="PT" :width="Math.max(0, w - PR - xNow)" :height="plotH" class="future-bg" rx="6" />

      <!-- history: solid line + area -->
      <g :class="{ drawn }">
        <path v-for="(seg, i) in histSegs" :key="`a${i}`" :d="area(seg)" fill="url(#soc-fill)" class="area" clip-path="url(#soc-clip)" />
        <path v-for="(seg, i) in histSegs" :key="`l${i}`" :d="line(seg)" class="hist" pathLength="1" />
      </g>
      <!-- plan: dashed projection -->
      <path v-if="forecast.length > 1" :d="line(forecast)" class="fore" :class="{ drawn }" />

      <!-- action strip for the planned slots -->
      <g class="strip">
        <rect
          v-for="(s, i) in strip" :key="i" :x="s.x" :y="H - PB + 8" :width="Math.max(1, s.w - 1)" height="6" rx="2"
          :fill="ACTION[s.action]?.color ?? 'var(--c-hold)'"
        />
      </g>

      <!-- time axis -->
      <g class="axis">
        <text v-for="t in ticks" :key="t.x" :x="t.x" :y="H - 2" text-anchor="middle">{{ t.label }}</text>
      </g>

      <!-- now -->
      <line :x1="xNow" :x2="xNow" :y1="PT - 6" :y2="H - PB" class="now-line" />
      <text :x="xNow" :y="PT - 10" text-anchor="middle" class="now-label">Now</text>
      <circle :cx="xNow" :cy="y(socNow)" r="9" class="now-halo" />
      <circle :cx="xNow" :cy="y(socNow)" r="4.5" class="now-dot" />

      <!-- crosshair -->
      <g v-if="tip">
        <line :x1="tip.x" :x2="tip.x" :y1="PT" :y2="H - PB" class="cross" />
        <circle :cx="tip.x" :cy="tip.y" r="5" class="cross-dot" :class="{ future: tip.future }" />
      </g>
    </svg>

    <div v-if="tip" class="tooltip" :style="{ left: `${Math.min(Math.max(tip.x, 70), w - 70)}px` }">
      <div class="t-time">{{ tip.time }}<span v-if="tip.future"> · planned</span></div>
      <div class="t-val">{{ tip.pct }}%</div>
      <div v-if="tip.action" class="t-act"><span class="dot" :style="{ background: ACTION[tip.action]?.color }" /> {{ ACTION[tip.action]?.label }}</div>
    </div>

    <div class="legend">
      <span><i class="sw solid" /> Last 12 h</span>
      <span><i class="sw dashed" /> Plan</span>
      <span v-for="a in presentActions" :key="a"><i class="sw block" :style="{ background: ACTION[a]!.color }" /> {{ ACTION[a]!.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Pt { ts: string | Date; soc: number; action?: string }
const props = defineProps<{ history: Pt[]; forecast: Pt[]; now: string; socNow: number; reserve: number }>()

const ACTION: Record<string, { label: string; color: string }> = {
  charge_grid: { label: 'Grid charge', color: 'var(--c-grid-charge)' },
  discharge: { label: 'Discharge', color: 'var(--c-discharge)' },
  self_use: { label: 'Self-use', color: 'var(--c-self-use)' },
  solar_only: { label: 'Hold', color: 'var(--c-hold)' },
}

const H = 210
const PT = 22
const PB = 34
const PL = 4
const PR = 40
const plotH = H - PT - PB
const SPAN = 12 * 3600_000

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

const tNow = computed(() => new Date(props.now).getTime())
const t0 = computed(() => tNow.value - SPAN)
const t1 = computed(() => tNow.value + SPAN)
const x = (t: number) => PL + ((t - t0.value) / (t1.value - t0.value)) * (w.value - PL - PR)
const y = (soc: number) => PT + (1 - Math.min(1, Math.max(0, soc))) * plotH
const xNow = computed(() => x(tNow.value))
const ms = (p: Pt) => new Date(p.ts).getTime()

// Break the history line where samples are missing for more than 30 minutes
const histSegs = computed(() => {
  const pts = props.history.filter((p) => ms(p) >= t0.value).concat([{ ts: props.now, soc: props.socNow }])
  const segs: Pt[][] = []
  let cur: Pt[] = []
  for (const p of pts) {
    if (cur.length && ms(p) - ms(cur[cur.length - 1]!) > 30 * 60_000) {
      segs.push(cur)
      cur = []
    }
    cur.push(p)
  }
  if (cur.length > 1) segs.push(cur)
  return segs
})
const forecast = computed(() => props.forecast.filter((p) => ms(p) <= t1.value))

function smooth(pts: [number, number][]) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('')
  // monotone-ish cubic: control points at a third of the way, y flattened at turning points
  let d = `M${pts[0]![0]},${pts[0]![1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[i + 1]!
    const dx = (x1 - x0) / 3
    d += `C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`
  }
  return d
}
const line = (seg: Pt[]) => smooth(seg.map((p) => [x(ms(p)), y(p.soc)]))
const area = (seg: Pt[]) => {
  const first = seg[0]!
  const last = seg[seg.length - 1]!
  return `${line(seg)}L${x(ms(last))},${H - PB}L${x(ms(first))},${H - PB}Z`
}

const strip = computed(() => {
  const f = forecast.value
  return f.slice(1).map((p, i) => {
    const a = x(ms(f[i]!))
    return { x: a, w: x(ms(p)) - a, action: p.action ?? 'solar_only' }
  })
})
const presentActions = computed(() => [...new Set(strip.value.map((s) => s.action))].filter((a) => ACTION[a]))

const ticks = computed(() => {
  const out: { x: number; label: string }[] = []
  const step = w.value < 420 ? 6 : 3
  const start = new Date(t0.value)
  start.setMinutes(0, 0, 0)
  for (let t = start.getTime() + 3600_000; t < t1.value; t += 3600_000) {
    const h = new Date(t).getHours()
    if (h % step !== 0) continue
    const xx = x(t)
    if (Math.abs(xx - xNow.value) < 22 || xx < 14 || xx > w.value - PR - 10) continue
    out.push({ x: xx, label: `${String(h).padStart(2, '0')}:00` })
  }
  return out
})

const tip = ref<{ x: number; y: number; time: string; pct: number; action?: string; future: boolean } | null>(null)
function hover(e: PointerEvent) {
  const rect = wrap.value!.getBoundingClientRect()
  const px = e.clientX - rect.left
  const all: (Pt & { future: boolean })[] = [
    ...props.history.filter((p) => ms(p) >= t0.value).map((p) => ({ ...p, future: false })),
    ...forecast.value.slice(1).map((p) => ({ ...p, future: true })),
  ]
  if (!all.length) return
  let best = all[0]!
  for (const p of all) if (Math.abs(x(ms(p)) - px) < Math.abs(x(ms(best)) - px)) best = p
  tip.value = {
    x: x(ms(best)),
    y: y(best.soc),
    time: new Date(best.ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
    pct: Math.round(best.soc * 100),
    action: best.future ? best.action : undefined,
    future: best.future,
  }
}

const aria = computed(() => {
  const end = forecast.value[forecast.value.length - 1]
  return `Charge level now ${Math.round(props.socNow * 100)}%` + (end ? `, planned ${Math.round(end.soc * 100)}% in 12 hours` : '')
})
</script>

<style scoped>
.timeline { position: relative; touch-action: pan-y; user-select: none; }
svg { display: block; overflow: visible; }
.gridlines line { stroke: var(--grid); stroke-width: 1; }
.gridlines text, .axis text { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.reserve line { stroke: var(--sys-red); stroke-opacity: 0.5; stroke-dasharray: 3 4; }
.reserve text { fill: var(--sys-red); fill-opacity: 0.8; font-size: 11px; }
.future-bg { fill: rgba(255, 255, 255, 0.025); }
.hist { fill: none; stroke: var(--sys-green); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
.drawn .hist { stroke-dashoffset: 0; transition: stroke-dashoffset 1.4s var(--ease-out); }
.area { opacity: 0; }
.drawn .area { opacity: 1; transition: opacity 1s 0.5s; }
.fore { fill: none; stroke: var(--sys-green); stroke-opacity: 0.7; stroke-width: 2; stroke-dasharray: 2 5; stroke-linecap: round; opacity: 0; }
.fore.drawn { opacity: 1; transition: opacity 0.8s 1.1s; animation: march 1.6s linear infinite; }
@keyframes march { to { stroke-dashoffset: -14; } }
.strip rect { transition: opacity 0.3s; }
.now-line { stroke: var(--text-2); stroke-width: 1; stroke-dasharray: 2 3; }
.now-label { fill: var(--text-2); font-size: 11px; font-weight: 600; }
.now-dot { fill: var(--sys-green); stroke: var(--surface); stroke-width: 2; }
.now-halo { fill: var(--sys-green); opacity: 0.25; transform-box: fill-box; transform-origin: center; animation: halo 2.2s ease-out infinite; }
@keyframes halo { 0% { transform: scale(0.6); opacity: 0.5; } 100% { transform: scale(2); opacity: 0; } }
.cross { stroke: var(--text); stroke-opacity: 0.35; stroke-width: 1; }
.cross-dot { fill: var(--sys-green); stroke: var(--surface); stroke-width: 2; }
.cross-dot.future { fill: var(--surface); stroke: var(--sys-green); }
.tooltip {
  position: absolute; top: -8px; transform: translate(-50%, -100%); pointer-events: none;
  background: var(--surface-3); border-radius: 12px; padding: 8px 12px; min-width: 112px; text-align: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.t-time { font-size: 12px; color: var(--text-2); }
.t-val { font: 600 20px/1.2 var(--font-rounded); font-variant-numeric: tabular-nums; }
.t-act { font-size: 12px; display: flex; gap: 6px; align-items: center; justify-content: center; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 12px; color: var(--text-2); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { display: inline-block; width: 14px; height: 0; }
.sw.solid { border-top: 2.5px solid var(--sys-green); border-radius: 2px; }
.sw.dashed { border-top: 2px dotted var(--sys-green); }
.sw.block { height: 6px; width: 12px; border-radius: 2px; }
</style>
