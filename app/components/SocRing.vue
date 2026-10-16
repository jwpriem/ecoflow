<template>
  <div class="ring" :style="{ width: `${size}px` }">
    <svg :viewBox="`0 0 ${size} ${size}`" role="img" :aria-label="`${Math.round(value * 100)}%`">
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="var(--c-battery-1)" />
          <stop offset="100%" stop-color="var(--sys-green)" />
        </linearGradient>
      </defs>
      <g :transform="`rotate(-90 ${c} ${c})`">
        <circle :cx="c" :cy="c" :r="r" class="track" :stroke-width="stroke" />
        <!-- reserve marker: the level the batteries never go below -->
        <circle
          v-if="reserve > 0"
          :cx="c" :cy="c" :r="r" fill="none" stroke="rgba(0,0,0,.55)" :stroke-width="stroke"
          :stroke-dasharray="`1.5 ${circ}`" :stroke-dashoffset="-circ * reserve"
        />
        <circle
          :cx="c" :cy="c" :r="r" fill="none" :stroke="`url(#${gid})`" :stroke-width="stroke" stroke-linecap="round"
          :stroke-dasharray="`${circ * Math.max(0.001, shown)} ${circ}`"
          :class="['arc', state]"
        />
      </g>
      <!-- a chevron rides the tip of the arc while charging or discharging -->
      <g v-if="state !== 'idle'" :transform="capTransform">
        <path
          :d="state === 'charging' ? 'M-3 -4 L2 0 L-3 4' : 'M3 -4 L-2 0 L3 4'"
          :transform="`scale(${stroke / 22})`"
          fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="chev"
        />
      </g>
    </svg>
    <div class="center"><slot :value="shown" /></div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ value: number; size?: number; stroke?: number; powerW?: number; reserve?: number }>(), {
  size: 220,
  stroke: 22,
  powerW: 0,
  reserve: 0,
})

const gid = `ring-${useId()}`
const c = computed(() => props.size / 2)
const r = computed(() => props.size / 2 - props.stroke / 2 - 2)
const circ = computed(() => 2 * Math.PI * r.value)
const tween = useTweened(() => props.value, { stiffness: 40 })
const shown = computed(() => Math.min(1, Math.max(0, tween.value)))
const state = computed(() => (props.powerW > 5 ? 'charging' : props.powerW < -5 ? 'discharging' : 'idle'))
const capTransform = computed(() => {
  const a = -Math.PI / 2 + 2 * Math.PI * Math.max(0.02, shown.value)
  return `translate(${c.value + r.value * Math.cos(a)} ${c.value + r.value * Math.sin(a)}) rotate(${(a * 180) / Math.PI + 90})`
})
</script>

<style scoped>
.ring { position: relative; aspect-ratio: 1; max-width: 100%; flex: none; }
svg { width: 100%; height: 100%; overflow: visible; display: block; }
.track { fill: none; stroke: var(--c-battery-1); opacity: 0.2; }
.arc.charging { filter: drop-shadow(0 0 6px rgba(48, 209, 88, 0.45)); animation: breathe 2.4s ease-in-out infinite; }
.arc.discharging { filter: drop-shadow(0 0 6px rgba(255, 159, 10, 0.35)); }
@keyframes breathe { 50% { filter: drop-shadow(0 0 12px rgba(48, 209, 88, 0.7)); } }
.chev { opacity: 0.85; }
.center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
</style>
