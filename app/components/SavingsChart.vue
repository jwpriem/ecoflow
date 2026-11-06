<template>
  <div class="savings-chart">
    <div
      ref="box" class="box" tabindex="0" role="group" :aria-label="aria"
      @keydown.left.prevent="step(-1)" @keydown.right.prevent="step(1)"
    >
      <svg v-if="w" :width="w" :height="H" @click="pick">
        <!-- the selected slot gets a column behind it -->
        <rect v-if="modelValue >= 0 && modelValue < slots.length" :x="modelValue * slotW" :y="PT - 4" :width="slotW" :height="PB - PT + 8" class="sel-col" />

        <g class="grid">
          <line v-for="g in grid" :key="g" :x1="0" :x2="plotW" :y1="y(g)" :y2="y(g)" :class="{ zero: g === 0 }" />
        </g>

        <g v-for="(s, i) in slots" :key="i">
          <rect v-if="s.future" :x="x(i)" :y="y(0) - 3" :width="barW" height="3" rx="1" class="future" />
          <template v-else>
            <rect v-if="s.battery > 0" :x="x(i)" :y="y(s.battery)" :width="barW" :height="h(s.battery)" rx="1" class="battery" />
            <rect v-if="s.solar > 0" :x="x(i)" :y="y(Math.max(0, s.battery) + s.solar)" :width="barW" :height="h(s.solar)" rx="1" class="solar" />
            <rect v-if="neg(s) < 0" :x="x(i)" :y="y(0)" :width="barW" :height="h(-neg(s))" rx="1" class="loss" />
          </template>
        </g>

        <line v-if="average != null" :x1="0" :x2="plotW" :y1="y(average)" :y2="y(average)" class="avg" />

        <g class="axis">
          <text v-for="t in ticks" :key="t" :x="x(t) + barW / 2" :y="H - 4" text-anchor="middle">{{ slots[t]?.label }}</text>
        </g>
      </svg>
    </div>
    <div class="y-axis" aria-hidden="true">
      <span v-for="g in grid.filter((g) => g !== 0)" :key="g" :style="{ top: `${y(g)}px` }">{{ format(g) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface SavingsSlot {
  label: string
  battery: number
  solar: number
  future: boolean
}
const props = defineProps<{ slots: SavingsSlot[]; modelValue: number; ticks: number[]; average: number | null; format: (v: number) => string; aria: string }>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()

const PT = 10
const PB = 150
const H = PB + 22
const AXIS = 44

const box = ref<HTMLElement>()
const w = ref(0)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => (w.value = Math.round(e!.contentRect.width)))
  ro.observe(box.value!)
})
onBeforeUnmount(() => ro?.disconnect())

const plotW = computed(() => Math.max(0, w.value - AXIS))
const slotW = computed(() => plotW.value / Math.max(1, props.slots.length))
const barW = computed(() => Math.max(2, Math.min(28, slotW.value * 0.7)))
const x = (i: number) => i * slotW.value + (slotW.value - barW.value) / 2

const neg = (s: SavingsSlot) => Math.min(0, s.battery) + Math.min(0, s.solar)
const top = computed(() => Math.max(0, ...props.slots.map((s) => Math.max(0, s.battery) + Math.max(0, s.solar))))
const bottom = computed(() => Math.min(0, ...props.slots.map(neg)))

// Two or three round gridlines: 1, 2, 5 times a power of ten
const stepSize = computed(() => {
  const raw = Math.max(top.value, -bottom.value, 0.01) / 2.2
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((f) => f * p).find((s) => s >= raw)!
})
const max = computed(() => Math.max(stepSize.value, Math.ceil(top.value / stepSize.value) * stepSize.value))
const min = computed(() => (bottom.value < 0 ? Math.floor(bottom.value / stepSize.value) * stepSize.value : 0))
const grid = computed(() => {
  const out: number[] = []
  for (let g = min.value; g <= max.value + 1e-9; g += stepSize.value) out.push(Math.round(g * 1e6) / 1e6)
  return out
})
const y = (v: number) => PT + ((max.value - v) / (max.value - min.value)) * (PB - PT)
const h = (v: number) => Math.max(1, y(0) - y(v))

function pick(e: MouseEvent) {
  const i = Math.floor((e.clientX - (e.currentTarget as SVGSVGElement).getBoundingClientRect().left) / slotW.value)
  if (i >= 0 && i < props.slots.length && !props.slots[i]!.future) emit('update:modelValue', i)
}
function step(d: number) {
  let i = props.modelValue + d
  while (i >= 0 && i < props.slots.length && props.slots[i]!.future) i += d
  if (i >= 0 && i < props.slots.length) emit('update:modelValue', i)
}
</script>

<style scoped>
.savings-chart { position: relative; }
.box { border-radius: 2px; }
svg { display: block; cursor: pointer; overflow: visible; }
text { font-size: 12px; font-variant-numeric: tabular-nums; font-stretch: 85%; fill: var(--muted); }
.grid line { stroke: var(--grid); }
.grid line.zero { stroke: var(--rule); }
.sel-col { fill: var(--fill-2); }
.battery { fill: var(--text); }
.solar { fill: var(--sun); }
.loss { fill: var(--alert); }
.future { fill: var(--fill); }
.avg { stroke: var(--text-2); stroke-width: 1; stroke-dasharray: 3 3; }
rect { transition: y 0.4s var(--ease-out), height 0.4s var(--ease-out); }
.y-axis { position: absolute; top: 0; right: 0; width: 44px; pointer-events: none; }
.y-axis span { position: absolute; right: 0; transform: translateY(-50%); font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; font-stretch: 85%; }
@media (prefers-reduced-motion: reduce) {
  rect { transition: none; }
}
</style>
