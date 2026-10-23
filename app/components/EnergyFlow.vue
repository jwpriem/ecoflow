<template>
  <div class="flow">
    <svg viewBox="0 0 340 236" role="img" :aria-label="aria">
      <g v-for="l in links" :key="l.key">
        <path :d="l.d" class="wire" />
        <path
          v-if="l.active"
          :d="l.d"
          class="pulse"
          :class="{ still: !animate }"
          :style="{ stroke: l.color, animationDuration: `${l.dur}s`, animationDirection: l.toHub ? 'normal' : 'reverse', strokeWidth: l.width }"
        />
      </g>
      <circle cx="170" cy="118" r="5" class="hub" />

      <g v-for="n in nodes" :key="n.key" :transform="`translate(${n.x} ${n.y})`" class="node" :class="{ active: n.active }">
        <circle r="25" class="node-bg" :style="{ '--glow': n.color }" />
        <foreignObject x="-12" y="-12" width="24" height="24">
          <AppIcon :name="n.icon" class="node-icon" :style="{ color: n.active ? n.color : 'var(--text-2)' }" />
        </foreignObject>
        <text :x="n.labelX ?? 0" :y="n.labelY" :text-anchor="n.labelX ? 'start' : 'middle'" class="n-label">{{ n.label }}</text>
        <text :x="n.labelX ?? 0" :y="n.labelY + 17" :text-anchor="n.labelX ? 'start' : 'middle'" class="n-value">{{ n.value }}</text>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ solarW: number | null; gridW: number | null; batteryW: number; houseW: number | null; animate?: boolean }>(), { animate: true })

const HUB = [170, 118] as const
const POS = {
  solar: [170, 34],
  grid: [42, 118],
  house: [298, 118],
  battery: [170, 202],
} as const

const fmt = (w: number | null) => (w == null ? '–' : Math.abs(w) >= 1000 ? `${num(Math.abs(w) / 1000)} kW` : `${Math.round(Math.abs(w))} W`)
// Faster dots for more power: 2.6 s per cycle when trickling, 0.5 s at 3 kW
const dur = (w: number) => Math.max(0.5, 2.6 - (Math.min(3000, Math.abs(w)) / 3000) * 2.1)
const width = (w: number) => 3 + Math.min(2.5, Math.abs(w) / 1200)

function curve(from: readonly [number, number]) {
  const [x, y] = from
  const [hx, hy] = HUB
  if (x === hx) return `M${x},${y + (y < hy ? 26 : -26)} L${hx},${hy}`
  return `M${x + (x < hx ? 26 : -26)},${y} L${hx},${hy}`
}

const links = computed(() => {
  const solar = props.solarW ?? 0
  const grid = props.gridW ?? 0
  const bat = props.batteryW
  const house = props.houseW ?? 0
  return [
    { key: 'solar', d: curve(POS.solar), w: solar, toHub: true, color: 'var(--sys-yellow)' },
    { key: 'grid', d: curve(POS.grid), w: grid, toHub: grid > 0, color: grid > 0 ? 'var(--sys-blue)' : 'var(--sys-teal)' },
    { key: 'battery', d: curve(POS.battery), w: bat, toHub: bat < 0, color: bat < 0 ? 'var(--sys-orange)' : 'var(--sys-green)' },
    { key: 'house', d: curve(POS.house), w: house, toHub: false, color: 'var(--text)' },
  ].map((l) => ({ ...l, active: Math.abs(l.w) > 5, dur: dur(l.w), width: width(l.w) }))
})

const { m } = useLocale()
const nodes = computed(() => {
  const t = m.value.flow
  const g = props.gridW ?? 0
  const b = props.batteryW
  return [
    { key: 'solar', icon: 'sun', label: t.solar, value: fmt(props.solarW), x: POS.solar[0], y: POS.solar[1], labelX: 36, labelY: -4, color: 'var(--sys-yellow)', active: (props.solarW ?? 0) > 5 },
    { key: 'grid', icon: 'grid', label: g > 5 ? t.importing : g < -5 ? t.exporting : t.grid, value: fmt(props.gridW), x: POS.grid[0], y: POS.grid[1], labelY: 44, color: g > 0 ? 'var(--sys-blue)' : 'var(--sys-teal)', active: Math.abs(g) > 5 },
    { key: 'house', icon: 'house', label: t.house, value: fmt(props.houseW), x: POS.house[0], y: POS.house[1], labelY: 44, color: 'var(--text)', active: (props.houseW ?? 0) > 5 },
    { key: 'battery', icon: 'battery', label: b > 5 ? t.charging : b < -5 ? t.discharging : t.batteries, value: fmt(b), x: POS.battery[0], y: POS.battery[1], labelX: 36, labelY: -4, color: b < 0 ? 'var(--sys-orange)' : 'var(--sys-green)', active: Math.abs(b) > 5 },
  ]
})

const aria = computed(() => nodes.value.map((n) => `${n.label} ${n.value}`).join(', '))
</script>

<style scoped>
.flow { margin: 0 -6px; }
svg { width: 100%; height: auto; display: block; overflow: visible; }
.wire { fill: none; stroke: var(--fill); stroke-width: 3; stroke-linecap: round; }
.pulse { fill: none; stroke-linecap: round; stroke-dasharray: 0 12; animation: flow linear infinite; }
.pulse.still { animation: none; }
@keyframes flow { to { stroke-dashoffset: -12; } }
.hub { fill: var(--surface-3); }
.node-bg { fill: var(--surface-2); transition: filter 0.6s; }
.node.active .node-bg { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--glow) 35%, transparent)); }
.node-icon { width: 24px; height: 24px; display: block; transition: color 0.4s; }
.n-label { fill: var(--text-2); font-size: 11px; font-weight: 500; }
.n-value { fill: var(--text); font: 600 15px var(--font-rounded); font-variant-numeric: tabular-nums; }
</style>
