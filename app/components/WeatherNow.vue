<template>
  <!-- Outdoor temperature and weather type at the household's location, from Open-Meteo,
       and with a Tuya sensor connected the indoor temperature beside it -->
  <span v-if="weather || indoor" class="weather-now">
    <span v-if="weather" class="weather" :title="label" role="img" :aria-label="label">
      <AppIcon :name="weatherIcon(kind, night)" />
      <span class="temp">{{ degrees(weather.tempC) }}</span>
    </span>
    <span v-if="indoor" class="weather" :title="insideLabel" role="img" :aria-label="insideLabel">
      <AppIcon name="house" />
      <span class="temp">{{ degrees(indoor.tempC) }}</span>
    </span>
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  weather: { tempC: number; code: number } | null
  indoor?: { tempC: number; humidity: number | null; name: string } | null
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
const insideLabel = computed(() =>
  props.indoor ? m.value.flow.inside(degrees(props.indoor.tempC), props.indoor.humidity === null ? null : `${Math.round(props.indoor.humidity)}%`, props.indoor.name) : '',
)
</script>

<style scoped>
.weather-now { display: inline-flex; align-items: center; gap: 12px; }
.weather { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; }
.weather :deep(svg) { width: 18px; height: 18px; flex: none; }
</style>
