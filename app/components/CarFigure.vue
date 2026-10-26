<template>
  <!-- The car drawn as a battery cell: the body fills with ink to the charge level, like the pack on Home -->
  <svg class="car-figure" viewBox="-28 0 348 108" role="img" :aria-label="label">
    <defs>
      <clipPath :id="clip"><path :d="BODY" /></clipPath>
    </defs>
    <line class="ground" x1="-28" y1="98" x2="320" y2="98" />

    <!-- Charge cable from the port at the rear, out of frame to the charger -->
    <template v-if="plugged">
      <path class="cable" :class="{ live: charging }" d="M8 57 C-6 58 -4 94 -28 95" />
      <rect class="plug" :class="{ live: charging }" x="4" y="53" width="8" height="8" rx="1.5" />
    </template>

    <g :clip-path="`url(#${clip})`">
      <rect class="fill" x="8" y="0" :width="at(soc)" height="108" />
      <!-- The leading edge shows energy going in -->
      <rect v-if="charging && soc" class="edge" :x="8 + at(soc) - 4" y="0" width="4" height="108" />
    </g>
    <path class="body" :d="BODY" />
    <path class="glass" d="M30 44 L50 34 Q54 32 61 32 L168 30 Q177 30 183 34 L210 47 Z" />
    <g v-for="cx in [74, 250]" :key="cx" class="wheel">
      <circle :cx="cx" cy="80" r="17" />
      <circle :cx="cx" cy="80" r="6" />
    </g>
    <!-- The charge limit, marked under the car like the reserve under the batteries -->
    <line v-if="target != null && target < 1" class="limit" :x1="8 + at(target)" :x2="8 + at(target)" y1="101" y2="107" />
  </svg>
</template>

<script setup lang="ts">
// soc and target are fractions (0–1); label is the spoken description
const props = defineProps<{ soc: number | null; charging?: boolean | null; plugged?: boolean | null; target?: number | null; label: string }>()

// Side profile, rear on the left; the wheel arches are cut out of the sill
const BODY = 'M12 80 L10 60 Q10 50 18 44 L40 32 Q46 28 56 27 L176 25 Q186 25 194 30 L232 48 L290 56 Q306 59 307 68 L306 80 L274 80 A24 24 0 0 0 226 80 L98 80 A24 24 0 0 0 50 80 Z'
const LENGTH = 300

const clip = `car-${useId()}`
const at = (f: number | null | undefined) => (f == null ? 0 : Math.min(1, Math.max(0, f)) * LENGTH)
</script>

<style scoped>
.car-figure { display: block; width: 100%; max-width: 440px; height: auto; overflow: visible; }
.ground { stroke: var(--rule); stroke-width: 1; }
.body { fill: none; stroke: var(--text); stroke-width: 1.5; stroke-linejoin: round; }
.fill { fill: var(--text); transition: width 1s var(--ease-out); }
.edge { fill: var(--cheap); animation: breathe 2.4s ease-in-out infinite; }
.glass { fill: var(--bg); stroke: var(--text); stroke-width: 1.5; stroke-linejoin: round; transition: fill 1.2s; }
.wheel circle { fill: var(--bg); stroke: var(--text); stroke-width: 1.5; transition: fill 1.2s; }
.wheel circle + circle { stroke-width: 1; }
.cable { fill: none; stroke: var(--text-2); stroke-width: 2; stroke-linecap: round; }
.plug { fill: var(--text-2); }
.cable.live { stroke: var(--cheap); }
.plug.live { fill: var(--cheap); }
.limit { stroke: var(--text-2); stroke-width: 1.5; }
@keyframes breathe { 50% { opacity: 0.45; } }
</style>
