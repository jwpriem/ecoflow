<template>
  <section class="plan" :aria-label="m.cars.plan.title">
    <h3>{{ m.cars.plan.title }}</h3>
    <p v-if="error" class="muted">{{ m.cars.plan.failed }}</p>
    <p v-else-if="!plan" class="muted">{{ m.cars.plan.loading }}</p>
    <p v-else-if="!plan.windows.length" class="muted">{{ m.cars.plan.none }}</p>
    <template v-else>
      <ol class="windows">
        <li v-for="w in plan.windows" :key="w.start" :class="{ now: isNow(w) }">
          <span class="when">
            <span class="day">{{ dayLabel(w.start) }}</span>
            {{ time(w.start) }}–{{ time(w.end) }}
          </span>
          <span class="soc">{{ socText(w) }}</span>
          <span class="cost">{{ kwh(w.energyKwh, 1) }} · {{ eur(w.cost) }}</span>
        </li>
      </ol>
      <p class="total">{{ m.cars.plan.total(kwh(plan.energyKwh, 1), eur(plan.cost)) }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
interface Window { start: string; end: string; fromSoc: number | null; toSoc: number | null; energyKwh: number; cost: number }
defineProps<{ plan: { windows: Window[]; energyKwh: number; cost: number } | null; error?: boolean }>()
const { m } = useLocale()

const isNow = (w: Window) => new Date(w.start).getTime() <= Date.now() && Date.now() < new Date(w.end).getTime()
const socText = (w: Window) => (w.fromSoc != null && w.toSoc != null ? `${w.fromSoc}% → ${w.toSoc}%` : w.toSoc != null ? `→ ${w.toSoc}%` : '')

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return m.value.day.today
  if (days === 1) return m.value.day.tomorrow
  return d.toLocaleDateString(m.value.dateLocale, { weekday: 'long' })
}
</script>

<style scoped>
.plan { margin-top: 22px; }
.plan h3 { font-size: 15px; font-weight: 700; margin: 0 0 6px; }
.muted { margin: 0; font-size: 14px; color: var(--text-2); }
.windows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
.windows li { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 0; border-bottom: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
.when { font-weight: 600; }
.day { color: var(--text-2); font-weight: 400; margin-right: 4px; }
.soc { text-align: right; font-weight: 600; }
.cost { grid-column: 1 / -1; font-size: 13px; color: var(--text-2); }
.now .when, .now .soc { color: var(--cheap); }
.total { margin: 8px 0 0; font-size: 13px; color: var(--text-2); }
</style>
