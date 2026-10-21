<template>
  <div class="price-chart">
    <div
      ref="scroller" class="scroller" tabindex="0" role="group" :aria-label="aria"
      @keydown.left.prevent="step(-1)" @keydown.right.prevent="step(1)" @keydown.home.prevent="emit('update:modelValue', nowIndex)"
    >
      <svg v-if="cw" :width="width" :height="H" @click="pick">
        <!-- price grid, every 10 ct -->
        <line v-for="g in gridSteps" :key="g" :x1="0" :x2="width" :y1="py(g)" :y2="py(g)" class="grid" :class="{ zero: g === 0 }" />

        <!-- the selected slot gets a column behind it -->
        <rect v-if="sel" :x="sel.x - 1" :y="PT" :width="slotW + 1" :height="PH" class="sel-col" />

        <rect
          v-for="b in bars" :key="b.i" :x="b.x" :width="barW" :y="Math.min(b.y, py(0))" :height="Math.max(1.5, Math.abs(py(0) - b.y))" rx="1"
          :fill="b.color" :class="{ past: b.past, selected: b.i === modelValue }"
        />

        <!-- day boundaries -->
        <g v-for="m in midnights" :key="m.x" class="day">
          <line :x1="m.x" :x2="m.x" :y1="4" :y2="PB + 6" />
          <text :x="m.x + 6" :y="15">{{ m.label }}</text>
        </g>
        <text v-if="showTodayLabel" x="2" y="15" class="day-t">Today</text>

        <!-- hour ticks along the bottom; labels every 3 hours -->
        <g class="axis">
          <template v-for="t in hours" :key="t.x">
            <line :x1="t.x" :x2="t.x" :y1="PB" :y2="PB + (t.label ? 6 : 3)" />
            <text v-if="t.label" :x="t.x" :y="PB + 19" text-anchor="middle">{{ t.label }}</text>
          </template>
        </g>

        <!-- now: a line at the exact minute, the current quarter marked on the baseline, the time in a tag -->
        <g v-if="nowIndex >= 0" class="now">
          <rect :x="nowIndex * slotW" :y="PB - 1" :width="slotW - 1" height="4" class="now-q" />
          <line :x1="xNow" :x2="xNow" :y1="24" :y2="PB" />
          <rect :x="xNow - 23" y="4" width="46" height="19" rx="4" class="now-tag" />
          <text :x="xNow" y="17.5" text-anchor="middle" class="now-t">{{ nowLabel }}</text>
        </g>
      </svg>
    </div>
    <!-- price axis stays put while the bars scroll under it -->
    <div class="y-axis" aria-hidden="true">
      <span v-for="g in gridSteps.filter((g) => g !== 0 || minP < 0)" :key="g" :style="{ top: `${py(g)}px` }">{{ Math.round(g * 100) }}<template v-if="g === maxP"> ct</template></span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Slot { slotStart: string; total: number; action: string | null }
const props = defineProps<{ slots: Slot[]; now: number; modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()

const COLOR: Record<string, string> = {
  charge_grid: 'var(--cheap)',
  discharge: 'var(--dear)',
  self_use: 'var(--own)',
  solar_only: 'var(--hold)',
}
const SLOT = 15 * 60_000
const PT = 30
const PH = 150
const PB = PT + PH
const H = PB + 26
const AXIS = 36

const scroller = ref<HTMLElement>()
const cw = ref(0)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => (cw.value = Math.round(e!.contentRect.width)))
  ro.observe(scroller.value!)
})
onBeforeUnmount(() => ro?.disconnect())

const start = computed(() => (props.slots[0] ? new Date(props.slots[0].slotStart).getTime() : props.now))
// At least 6 px per quarter so every bar stays readable; on a wide screen a single day fills the width
const slotW = computed(() => Math.max(6, (cw.value - AXIS) / Math.max(1, props.slots.length)))
const barW = computed(() => Math.max(1, slotW.value - 1.5))
const width = computed(() => props.slots.length * slotW.value + AXIS)

const maxP = computed(() => Math.max(0.1, Math.ceil(Math.max(...props.slots.map((s) => s.total)) * 10) / 10))
const minP = computed(() => Math.min(0, Math.floor(Math.min(...props.slots.map((s) => s.total)) * 10) / 10))
const py = (p: number) => PT + ((maxP.value - p) / (maxP.value - minP.value)) * PH
const gridSteps = computed(() => {
  const out: number[] = []
  for (let g = minP.value; g <= maxP.value + 1e-9; g += 0.1) out.push(Math.round(g * 10) / 10)
  return out
})

const nowIndex = computed(() => {
  const i = Math.floor((props.now - start.value) / SLOT)
  return i >= 0 && i < props.slots.length ? i : -1
})
const xNow = computed(() => ((props.now - start.value) / SLOT) * slotW.value)
const nowLabel = computed(() => new Date(props.now).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }))

const bars = computed(() =>
  props.slots.map((s, i) => ({
    i,
    x: i * slotW.value + 0.5,
    y: py(s.total),
    past: i < nowIndex.value,
    color: s.action ? (COLOR[s.action] ?? 'var(--hold)') : 'var(--fill)',
  })),
)
const sel = computed(() => (props.modelValue >= 0 && props.modelValue < props.slots.length ? { x: props.modelValue * slotW.value } : null))

const dayName = (d: Date) => {
  const today = new Date(props.now)
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000)
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long' })
}
const midnights = computed(() =>
  props.slots
    .map((s, i) => ({ d: new Date(s.slotStart), i }))
    .filter(({ d, i }) => i > 0 && d.getHours() === 0 && d.getMinutes() === 0)
    .map(({ d, i }) => ({ x: i * slotW.value, label: dayName(d) })),
)
// "Today" at the far left, unless the now tag sits on top of it
const showTodayLabel = computed(() => xNow.value > 90 || nowIndex.value < 0)
const hours = computed(() =>
  props.slots
    .map((s, i) => ({ d: new Date(s.slotStart), i }))
    .filter(({ d, i }) => i > 0 && d.getMinutes() === 0 && d.getHours() !== 0)
    .map(({ d, i }) => {
      const x = i * slotW.value
      const h = d.getHours()
      const label = h % 3 === 0 && Math.abs(x - xNow.value) > 28 ? `${String(h).padStart(2, '0')}:00` : ''
      return { x, label }
    }),
)

function pick(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const x = e.clientX - svg.getBoundingClientRect().left
  const i = Math.floor(x / slotW.value)
  if (i >= 0 && i < props.slots.length) emit('update:modelValue', i)
}
function step(d: number) {
  emit('update:modelValue', Math.min(props.slots.length - 1, Math.max(0, props.modelValue + d)))
}

// Keep the selected quarter in view: on first draw, now sits a quarter of the way in
function reveal(i: number, force = false) {
  const el = scroller.value
  if (!el || i < 0) return
  const x = i * slotW.value
  const visible = x > el.scrollLeft + 8 && x < el.scrollLeft + el.clientWidth - AXIS - 8
  if (force || !visible) el.scrollTo({ left: Math.max(0, x - el.clientWidth * 0.25), behavior: force ? 'auto' : 'smooth' })
}
watch(cw, (w, old) => !old && w && nextTick(() => reveal(props.modelValue, true)))
watch(() => props.modelValue, (i) => reveal(i))

const aria = computed(() => {
  const up = props.slots.slice(Math.max(0, nowIndex.value))
  if (!up.length) return 'Prices per 15 minutes'
  const lo = up.reduce((a, b) => (b.total < a.total ? b : a))
  const hi = up.reduce((a, b) => (b.total > a.total ? b : a))
  const t = (s: Slot) => new Date(s.slotStart).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return `Prices per 15 minutes. Cheapest ahead ${Math.round(lo.total * 100)} ct at ${t(lo)}, dearest ${Math.round(hi.total * 100)} ct at ${t(hi)}. Use the arrow keys to step through the quarters.`
})
</script>

<style scoped>
.price-chart { position: relative; }
.scroller { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain; border-radius: 2px; }
.scroller::-webkit-scrollbar { display: none; }
svg { display: block; cursor: pointer; }
text { font-size: 12px; font-variant-numeric: tabular-nums; font-stretch: 85%; fill: var(--muted); }
.grid { stroke: var(--grid); }
.grid.zero { stroke: var(--rule); }
.sel-col { fill: var(--fill-2); }
rect.past { opacity: 0.3; }
rect.selected { opacity: 1; stroke: var(--text); stroke-width: 1.5; }
.day line { stroke: var(--text-2); stroke-width: 1; }
.day text, .day-t { fill: var(--text); font-weight: 600; font-stretch: 100%; }
.axis line { stroke: var(--muted); }
.now line { stroke: var(--text); stroke-width: 1.5; }
.now-q { fill: var(--text); }
.now-tag { fill: var(--text); }
.now-t { fill: var(--bg); font-weight: 650; font-size: 12px; }
.y-axis {
  position: absolute; top: 0; right: 0; bottom: 0; width: 36px; pointer-events: none;
  background: linear-gradient(90deg, transparent, var(--bg) 40%);
}
.y-axis span { position: absolute; right: 0; transform: translateY(-50%); font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; font-stretch: 85%; }
</style>
