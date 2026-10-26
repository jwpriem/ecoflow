<template>
  <!-- The car, parked on its own charge: the floor under the tyres is the battery, filled with ink like the pack on Home -->
  <figure class="car-figure" role="img" :aria-label="label">
    <img v-if="photo" class="photo" :src="photo.src" :width="photo.w" :height="photo.h" :style="{ width: `${photo.scale * SIZE * 100}%` }" alt="" decoding="async" />
    <div class="floor">
      <div class="charge" :class="{ charging }" :style="{ width: `${pct(soc)}%` }" />
      <!-- The charge limit, marked under the floor like the reserve under the batteries -->
      <i v-if="target != null && target < 1" class="limit" :style="{ left: `${pct(target)}%` }" />
    </div>
  </figure>
</template>

<script setup lang="ts">
// soc and target are fractions (0–1); label is the spoken description
const props = defineProps<{ soc: number | null; charging?: boolean | null; target?: number | null; model?: string | null; name?: string | null; label: string }>()

// Product renders by Zeekr (zeekr.eu, zeekrlife.com), cut to the car. Each is drawn at its real length
// against the longest, the 001 (4,970 mm), so the two cars keep their sizes next to each other.
// The longest takes 60% of the width, so the car doesn't crowd the figures around it
const SIZE = 0.6
const PHOTOS = {
  '001': { src: '/cars/zeekr-001.webp', w: 1200, h: 495, scale: 1 },
  x: { src: '/cars/zeekr-x.webp', w: 1200, h: 604, scale: 4450 / 4970 },
}
const photo = computed(() => {
  const s = `${props.model ?? ''} ${props.name ?? ''}`
  if (/\b001\b/.test(s)) return PHOTOS['001']
  // "X" on its own, so a 7X doesn't count
  if (/(^|\s)x(\s|$)/i.test(s)) return PHOTOS.x
  return null
})
const pct = (f: number | null | undefined) => (f == null ? 0 : Math.min(1, Math.max(0, f)) * 100)
</script>

<style scoped>
.car-figure { margin: 20px 0 24px; display: flex; flex-direction: column; align-items: center; }
.photo { display: block; max-width: 100%; height: auto; }
/* The floor sits right under the tyres: the photo's own shadow fades into it */
.floor { position: relative; align-self: stretch; height: 8px; margin-top: -6px; border-radius: 2px; background: var(--fill); }
.charge { height: 100%; border-radius: 2px; background: var(--text); transition: width 1s var(--ease-out); }
/* The leading edge shows energy going in */
.charge.charging { box-shadow: inset -4px 0 0 var(--cheap); animation: breathe 2.4s ease-in-out infinite; }
.limit { position: absolute; top: 11px; width: 1.5px; height: 6px; margin-left: -0.75px; background: var(--text-2); }
@keyframes breathe { 50% { box-shadow: inset -4px 0 0 color-mix(in srgb, var(--cheap) 45%, transparent); } }
</style>
