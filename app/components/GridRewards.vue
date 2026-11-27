<template>
  <section class="rewards" :aria-label="m.cars.rewards.title">
    <h2>{{ m.cars.rewards.title }}</h2>
    <p v-if="error" class="muted">{{ m.cars.rewards.failed }}</p>
    <template v-else-if="rewards">
      <div class="amounts">
        <div>
          <span class="label">{{ m.cars.rewards.month }}</span>
          <span class="amount">{{ money(rewards.currentMonth) }}</span>
        </div>
        <div>
          <span class="label">{{ m.cars.rewards.allTime }}</span>
          <span class="amount quiet">{{ money(rewards.allTime) }}</span>
        </div>
      </div>
      <p v-if="rewards.state" class="state" :class="rewards.state">
        {{ m.cars.rewards[rewards.state] }}<template v-if="rewards.state === 'unavailable' && reasons.length"> ({{ reasons.join(', ') }})</template>
      </p>
      <p class="foot">{{ m.cars.rewards.foot }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
interface Rewards {
  state: 'delivering' | 'available' | 'unavailable' | null
  reasons: string[]
  currency: string | null
  currentMonth: number | null
  allTime: number | null
}
const props = defineProps<{ rewards: Rewards | null; error?: boolean }>()
const { m } = useLocale()

function money(v: number | null) {
  if (v == null) return '–'
  const currency = props.rewards?.currency
  if (!currency || currency === 'EUR') return eur(v)
  try {
    return new Intl.NumberFormat(m.value.dateLocale, { style: 'currency', currency }).format(v)
  } catch {
    return `${num(v)} ${currency}`
  }
}
// Tibber's reason codes in words: "VehicleNotPluggedIn" -> "vehicle not plugged in"
const reasons = computed(() =>
  (props.rewards?.reasons ?? []).map((r) => r.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()),
)
</script>

<style scoped>
.rewards { border-top: 1px solid var(--rule); padding-top: 14px; margin-bottom: 36px; }
.rewards h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; letter-spacing: -0.005em; margin: 0 0 12px; }
.muted { margin: 0; font-size: 14px; color: var(--text-2); }
.amounts { display: flex; gap: 40px; }
.amounts > div { display: flex; flex-direction: column; gap: 2px; }
.label { font-size: 13px; color: var(--text-2); }
.amount { font-size: 36px; line-height: 1; font-weight: 650; font-stretch: 75%; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.amount.quiet { color: var(--text-2); }
.state { margin: 12px 0 0; font-size: 14px; font-weight: 600; color: var(--text-2); }
.state.delivering { color: var(--cheap); }
.foot { font-size: 13px; color: var(--text-2); margin: 8px 0 0; max-width: 60ch; }
</style>
