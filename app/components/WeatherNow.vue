<template>
  <!-- Outdoor temperature and weather type at the household's location, from Open-Meteo -->
  <span v-if="weather" class="weather" :title="label" role="img" :aria-label="label">
    <AppIcon :name="weatherIcon(kind, night)" />
    <span class="temp">{{ degrees(weather.tempC) }}</span>
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  weather: { tempC: number; code: number } | null
  location?: { lat: number; lon: number } | null
  now?: string | Date
}>()
const { m } = useLocale()
const kind = computed(() => weatherKind(props.weather?.code ?? 0))
const night = computed(() => {
  const at = props.now ? new Date(props.now) : new Date()
  return sunPosition(at, props.location?.lat, props.location?.lon).altitude < -0.833
})
const label = computed(() => (props.weather ? m.value.flow.outside(degrees(props.weather.tempC), m.value.flow.weather[kind.value]) : ''))
</script>

<style scoped>
.weather { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; }
.weather :deep(svg) { width: 18px; height: 18px; flex: none; }
</style>
