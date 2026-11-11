<template>
  <!-- The car, parked on its own charge: the floor under the tyres is the battery, filled with ink like the pack on Home -->
  <figure class="car-figure" role="img" :aria-label="label">
    <!-- Every car stands on the same ground line, in a stage as tall as the tallest photo -->
    <div v-if="photo" class="stage">
      <img class="photo" :src="photo.src" :width="photo.w" :height="photo.h" :style="{ width: `${photo.scale * SIZE * 100}%` }" alt="" decoding="async" />
    </div>
    <div class="floor">
      <div class="charge" :class="{ charging }" :style="{ width: `${level}%` }" />
      <!-- The charge limit, marked under the floor like the reserve under the batteries -->
      <i v-if="target != null && target < 1" class="limit" :style="{ left: `${pct(target)}%` }" />
    </div>
  </figure>
</template>

<script setup lang="ts">
// soc and target are fractions (0–1); label is the spoken description
const props = defineProps<{ soc: number | null; charging?: boolean | null; target?: number | null; model?: string | null; name?: string | null; label: string }>()

// Product renders by Zeekr (zeekr.eu, zeekrlife.com), cut to the car. They are three-quarter views from
// different distances, so the length in the photo says little; the height does. Each is drawn at its
// real height against the 001 (1,548 mm; the X is 1,572 mm), measured on the car in the photo
// (474 of 495 px for the 001, 587 of 604 px for the X), so the two cars keep their sizes next to each other.
// The 001 takes 60% of the width, so the car doesn't crowd the figures around it
const SIZE = 0.6
const PHOTOS = {
  '001': { src: '/cars/zeekr-001.webp', w: 1200, h: 495, scale: 1 },
  x: { src: '/cars/zeekr-x.webp', w: 1200, h: 604, scale: (1572 / 1548) * (474 / 587) },
}
const photo = computed(() => {
  const s = `${props.model ?? ''} ${props.name ?? ''}`
  if (/\b001\b/.test(s)) return PHOTOS['001']
  // "X" on its own, so a 7X doesn't count
  if (/(^|\s)x(\s|$)/i.test(s)) return PHOTOS.x
  return null
})
const pct = (f: number | null | undefined) => (f == null ? 0 : Math.min(1, Math.max(0, f)) * 100)
// The charge runs up from empty when the car comes into view, in step with the percentage above it
// (pages/cars.vue uses the same spring), and glides to a new level after that
const level = useTweened(() => pct(props.soc), RISE)
</script>

<style scoped>
.car-figure { margin: 24px 0; display: flex; flex-direction: column; align-items: center; }
/* As tall as the 001 at 60% width (495/1200 of it); the X at its scale comes out just as tall */
.stage { align-self: stretch; aspect-ratio: 1200 / 297; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
.photo { display: block; max-width: 100%; height: auto; }
/* The charge bar keeps some air under the tyres, so the car doesn't stand on it */
.floor { position: relative; align-self: stretch; height: 8px; margin-top: 16px; border-radius: 2px; background: var(--fill); }
/* The width is driven by a spring (useTweened), so no transition here */
.charge { height: 100%; border-radius: 2px; background: var(--text); }
/* The leading edge shows energy going in */
.charge.charging { box-shadow: inset -4px 0 0 var(--cheap); animation: breathe 2.4s ease-in-out infinite; }
.limit { position: absolute; top: 11px; width: 1.5px; height: 6px; margin-left: -0.75px; background: var(--text-2); }
@keyframes breathe { 50% { box-shadow: inset -4px 0 0 color-mix(in srgb, var(--cheap) 45%, transparent); } }
</style>
