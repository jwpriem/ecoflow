<template>
  <div class="rings">
    <svg :viewBox="`0 0 ${S} ${S}`" role="img" :aria-label="aria">
      <defs>
        <linearGradient v-for="(r, i) in rings" :id="`ring-g-${i}`" :key="i" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" :stop-color="r.color" stop-opacity="0.75" />
          <stop offset="100%" :stop-color="r.tint" />
        </linearGradient>
      </defs>
      <g v-for="(r, i) in rings" :key="i" :transform="`rotate(-90 ${C} ${C})`">
        <circle :cx="C" :cy="C" :r="r.radius" class="track" :stroke="r.color" :stroke-width="W" />
        <!-- reserve marker: the level the batteries never go below -->
        <circle
          v-if="reserve > 0"
          :cx="C" :cy="C" :r="r.radius" fill="none" stroke="rgba(0,0,0,.55)" :stroke-width="W"
          :stroke-dasharray="`1.5 ${circ(r.radius)}`" :stroke-dashoffset="-circ(r.radius) * reserve"
        />
        <circle
          :cx="C" :cy="C" :r="r.radius" fill="none" :stroke="`url(#ring-g-${i})`" :stroke-width="W" stroke-linecap="round"
          :stroke-dasharray="`${circ(r.radius) * Math.max(0.001, r.value)} ${circ(r.radius)}`"
          :class="['arc', r.state]"
        />
      </g>
      <!-- round caps showing direction: a chevron rides the end of each charging/discharging ring -->
      <g v-for="(r, i) in rings" :key="`cap-${i}`">
        <g v-if="r.state !== 'idle'" :transform="capTransform(r.radius, r.value)">
          <path :d="r.state === 'charging' ? 'M-3 -4 L2 0 L-3 4' : 'M3 -4 L-2 0 L3 4'" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="chev" />
        </g>
      </g>
    </svg>
    <div class="center">
      <div class="pct"><span>{{ Math.round(combined * 100) }}</span><small>%</small></div>
      <div class="kwh">{{ storedKwh.toFixed(2) }} <span>/ {{ capacityKwh.toFixed(2) }} kWh</span></div>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface RingBattery {
  name: string
  soc: number | null
  powerW: number
  capacityWh: number
}

const props = defineProps<{ batteries: RingBattery[]; reserve?: number }>()
const S = 240
const C = S / 2
const W = 22
const GAP = 5
const COLORS = [
  { color: 'var(--c-battery-1)', tint: 'var(--sys-green)' },
  { color: 'var(--c-battery-2)', tint: 'var(--sys-teal)' },
]

const reserve = computed(() => props.reserve ?? 0)
const tweens = [0, 1, 2, 3].map((i) => useTweened(() => props.batteries[i]?.soc ?? 0, { stiffness: 40 }))
const rings = computed(() =>
  props.batteries.slice(0, 4).map((b, i) => ({
    radius: C - W / 2 - 2 - i * (W + GAP),
    value: Math.min(1, Math.max(0, tweens[i]!.value)),
    state: b.powerW > 5 ? 'charging' : b.powerW < -5 ? 'discharging' : 'idle',
    ...COLORS[i % COLORS.length]!,
  })),
)
const capacityKwh = computed(() => props.batteries.reduce((s, b) => s + b.capacityWh, 0) / 1000)
const storedKwhRaw = computed(() => props.batteries.reduce((s, b) => s + (b.soc ?? 0) * b.capacityWh, 0) / 1000)
const storedKwh = useTweened(() => storedKwhRaw.value, { stiffness: 40 })
const combined = computed(() => (capacityKwh.value ? storedKwh.value / capacityKwh.value : 0))
const aria = computed(() => props.batteries.map((b) => `${b.name} ${Math.round((b.soc ?? 0) * 100)}%`).join(', '))

const circ = (r: number) => 2 * Math.PI * r
function capTransform(r: number, v: number) {
  const a = -Math.PI / 2 + 2 * Math.PI * Math.max(0.02, v)
  const deg = (a * 180) / Math.PI + 90
  return `translate(${C + r * Math.cos(a)} ${C + r * Math.sin(a)}) rotate(${deg})`
}
</script>

<style scoped>
.rings { position: relative; width: min(240px, 68vw); aspect-ratio: 1; margin: 0 auto; }
svg { width: 100%; height: 100%; overflow: visible; }
.track { fill: none; opacity: 0.2; }
.arc.charging { filter: drop-shadow(0 0 6px rgba(48, 209, 88, 0.45)); animation: breathe 2.4s ease-in-out infinite; }
.arc.discharging { filter: drop-shadow(0 0 6px rgba(255, 159, 10, 0.35)); }
@keyframes breathe { 50% { filter: drop-shadow(0 0 12px rgba(48, 209, 88, 0.7)); } }
.chev { opacity: 0.85; animation: nudge 1.4s ease-in-out infinite; }
@keyframes nudge { 50% { transform: translateX(1.5px); } }
.center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
.pct { font: 600 52px/1 var(--font-rounded); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.pct small { font-size: 24px; font-weight: 500; color: var(--text-2); margin-left: 1px; }
.kwh { font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; margin-top: 4px; }
.kwh span { color: var(--text-2); font-weight: 400; }
</style>
