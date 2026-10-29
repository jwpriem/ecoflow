<template>
  <!-- An example day, not live data: the shape of a Dutch winter day with a solar dip at noon -->
  <figure class="day">
    <svg :viewBox="`0 0 ${W} ${H + 22}`" role="img" :aria-label="t.label">
      <line v-for="h in [0, 6, 12, 18, 24]" :key="`g${h}`" :x1="x(h * 4)" :x2="x(h * 4)" y1="0" :y2="H" class="grid" />
      <rect
        v-for="(q, i) in DAY"
        :key="i"
        :x="x(i) + 0.5"
        :y="H - bar(q.price)"
        :width="BW - 1"
        :height="bar(q.price)"
        :class="q.action"
        :style="{ '--i': i }"
      />
      <text v-for="h in [0, 6, 12, 18]" :key="`t${h}`" :x="x(h * 4) + 2" :y="H + 16" class="tick">{{ String(h).padStart(2, '0') }}:00</text>
    </svg>
    <figcaption>
      <ul class="legend small">
        <li><i class="key charge" />{{ t.charge }}</li>
        <li><i class="key discharge" />{{ t.discharge }}</li>
        <li><i class="key rest" />{{ t.rest }}</li>
      </ul>
      <p class="saved"><span class="small muted">{{ t.saved }}</span> <strong>{{ euro(SAVED, lang) }}</strong></p>
      <p class="small muted caption">{{ t.caption }}</p>
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { SITE_TEXT, type SiteLang } from '~/utils/site'

/** The home page's picture: one day of quarter-hour prices, coloured by what the battery does in each quarter. */
const props = defineProps<{ lang: SiteLang }>()
const t = computed(() => SITE_TEXT[props.lang].day)

const W = 384
const H = 150
const BW = W / 96
const MAX = 0.42
const x = (i: number) => i * BW
const bar = (p: number) => Math.round((p / MAX) * H * 10) / 10

type Quarter = { price: number; action: 'charge' | 'discharge' | 'rest' }

/** €/kWh incl. taxes per hour; the quarters vary a little around it so the strip reads as quarter prices */
const HOURLY = [0.24, 0.23, 0.22, 0.21, 0.21, 0.22, 0.26, 0.33, 0.36, 0.31, 0.26, 0.22, 0.19, 0.18, 0.2, 0.24, 0.29, 0.35, 0.39, 0.38, 0.33, 0.29, 0.27, 0.25]
const WOBBLE = [0.006, -0.004, 0.003, -0.006]
const CHARGE = new Set([2, 3, 4, 12, 13])
const DISCHARGE = new Set([7, 8, 17, 18, 19])
const DAY: Quarter[] = HOURLY.flatMap((p, h) =>
  WOBBLE.map((w, q) => ({ price: +(p + w * ((h + q) % 3 ? 1 : -1)).toFixed(3), action: CHARGE.has(h) ? 'charge' : DISCHARGE.has(h) ? 'discharge' : 'rest' })),
)

/** One STREAM (1.92 kWh), filled twice: what it costs to charge against what that power is worth later, at 90% round trip */
const KWH = 1.92
const avg = (a: Quarter['action']) => {
  const q = DAY.filter((d) => d.action === a)
  return q.reduce((s, d) => s + d.price, 0) / q.length
}
const SAVED = 2 * KWH * (0.9 * avg('discharge') - avg('charge'))
const euro = (v: number, lang: SiteLang) => new Intl.NumberFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(v)
</script>

<style scoped>
.day { margin: 0; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
.grid { stroke: var(--grid); stroke-width: 1; }
.tick { font-size: 10px; fill: var(--text-2); font-variant-numeric: tabular-nums; }
rect { transform-box: fill-box; transform-origin: bottom; animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both; animation-delay: calc(var(--i) * 9ms); }
rect.charge { fill: var(--cheap); }
rect.discharge { fill: var(--dear); }
rect.rest { fill: var(--surface-3); }
@keyframes rise { from { transform: scaleY(0); } }
@media (prefers-reduced-motion: reduce) { rect { animation: none; } }
figcaption { margin-top: 14px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; list-style: none; margin: 0 0 12px; padding: 0; color: var(--text-2); }
.legend li { display: flex; align-items: center; gap: 6px; }
.key { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.key.charge { background: var(--cheap); }
.key.discharge { background: var(--dear); }
.key.rest { background: var(--surface-3); }
.saved { margin: 0 0 6px; display: flex; align-items: baseline; gap: 10px; }
.saved strong { font-size: 28px; font-stretch: 112%; font-variant-numeric: tabular-nums; }
.caption { margin: 0; max-width: 52ch; line-height: 1.45; }
.small { font-size: 13px; }
.muted { color: var(--text-2); }
</style>
