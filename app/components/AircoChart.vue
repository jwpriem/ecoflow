<template>
  <!-- Indoor and outdoor temperature over time, and the set temperature while the unit was on -->
  <div ref="root" class="airco-chart" role="img" :aria-label="label">
    <svg v-if="w && points.length > 1" :width="w" :height="H">
      <g class="grid">
        <template v-for="g in grid" :key="g">
          <line :x1="PL" :x2="w" :y1="y(g)" :y2="y(g)" />
          <text :x="PL - 6" :y="y(g) + 4" text-anchor="end">{{ g }}°</text>
        </template>
      </g>
      <g class="axis">
        <text v-for="t in ticks" :key="t.x" :x="t.x" :y="H - 4" text-anchor="middle">{{ t.label }}</text>
      </g>
      <path v-for="(d, i) in targetPaths" :key="`t${i}`" :d="d" class="target" />
      <path :d="line('outdoorC')" class="outdoor" />
      <path :d="line('indoorC')" class="indoor" />
    </svg>
    <p v-else class="small muted empty">{{ emptyText }}</p>
  </div>
</template>

<script setup lang="ts">
interface Point { ts: string; running: boolean; targetC: number | null; indoorC: number | null; outdoorC: number | null }
const props = defineProps<{ points: Point[]; hours: number; label: string; emptyText: string }>()

const H = 150
const PL = 34
const PT = 8
const PB = H - 22
const root = ref<HTMLElement>()
const w = ref(0)

const end = computed(() => Date.now())
const start = computed(() => end.value - props.hours * 3_600_000)
const x = (ts: string) => PL + ((new Date(ts).getTime() - start.value) / (end.value - start.value)) * (w.value - PL)

const range = computed(() => {
  const vals = props.points.flatMap((p) => [p.indoorC, p.outdoorC, p.running ? p.targetC : null]).filter((v): v is number => v != null)
  if (!vals.length) return { lo: 0, hi: 25 }
  const lo = Math.floor(Math.min(...vals) / 5) * 5
  const hi = Math.ceil(Math.max(...vals) / 5) * 5
  return { lo, hi: hi === lo ? lo + 5 : hi }
})
const y = (c: number) => PT + ((range.value.hi - c) / (range.value.hi - range.value.lo)) * (PB - PT)
const grid = computed(() => {
  const out: number[] = []
  const step = range.value.hi - range.value.lo > 20 ? 10 : 5
  for (let g = range.value.lo; g <= range.value.hi; g += step) out.push(g)
  return out
})

/** A line through the readings, broken where one is missing or more than 20 minutes apart */
function line(key: 'indoorC' | 'outdoorC'): string {
  let d = ''
  let prev: number | null = null
  for (const p of props.points) {
    const v = p[key]
    const t = new Date(p.ts).getTime()
    if (v == null) {
      prev = null
      continue
    }
    d += `${prev != null && t - prev <= 20 * 60_000 ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(v).toFixed(1)}`
    prev = t
  }
  return d
}

/** The set temperature as steps, only while the unit was on */
const targetPaths = computed(() => {
  const paths: string[] = []
  let d = ''
  for (const p of props.points) {
    if (!p.running || p.targetC == null) {
      if (d) paths.push(d)
      d = ''
      continue
    }
    const px = x(p.ts).toFixed(1)
    const py = y(p.targetC).toFixed(1)
    d += d ? `H${px}V${py}` : `M${px},${py}`
  }
  if (d) paths.push(d)
  return paths
})

const ticks = computed(() => {
  const every = props.hours > 48 ? 24 : 6
  const out: { x: number; label: string }[] = []
  const first = new Date(start.value)
  first.setMinutes(0, 0, 0)
  for (let t = first.getTime() + 3_600_000; t < end.value; t += 3_600_000) {
    const d = new Date(t)
    if (d.getHours() % every) continue
    const label = every === 24 ? d.toLocaleDateString('nl-NL', { weekday: 'short' }) : `${String(d.getHours()).padStart(2, '0')}:00`
    const px = PL + ((t - start.value) / (end.value - start.value)) * (w.value - PL)
    if (px > PL + 12 && px < w.value - 12) out.push({ x: px, label })
  }
  return out
})

let ro: ResizeObserver | undefined
onMounted(() => {
  w.value = root.value!.clientWidth
  ro = new ResizeObserver(() => (w.value = root.value?.clientWidth ?? 0))
  ro.observe(root.value!)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.airco-chart { width: 100%; min-height: 40px; }
svg { display: block; overflow: visible; }
.grid line { stroke: var(--rule); stroke-width: 1; }
.grid text, .axis text { font-size: 11px; fill: var(--muted); font-variant-numeric: tabular-nums; }
path { fill: none; stroke-linejoin: round; stroke-linecap: round; }
.indoor { stroke: var(--text); stroke-width: 2; }
.outdoor { stroke: var(--sys-blue); stroke-width: 1.5; }
.target { stroke: var(--cta); stroke-width: 1.5; stroke-dasharray: 4 3; }
.empty { margin: 4px 0 0; }
</style>
