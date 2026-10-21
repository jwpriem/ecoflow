<template>
  <div>
    <header class="page-head"><h1>Savings</h1></header>

    <Segmented v-model="period" :options="periods" full aria-label="Period" />

    <template v-if="data">
      <section class="total">
        <p class="t-value" :class="{ neg: savingTotal < 0 }">{{ eur(savingT) }}</p>
        <p class="t-line">saved {{ rangeLabel }}</p>
      </section>

      <div class="basis">
        <Segmented v-model="basis" :options="bases" aria-label="How solar is counted" />
        <p class="hint">{{ basis === 'naive' ? 'Solar you store counts as free.' : 'Solar you store costs the feed-in price you would have got for it.' }}</p>
      </div>

      <div class="chart saved"><BarChart :key="`s-${period}-${basis}`" :labels="labels" :series="[{ label: 'Saved', data: savings, color: '--c-battery-1', colors: savings.map((v: number) => (v < 0 ? '--alert' : '--text')) }]" :legend="false" :format="(v) => eur(v)" /></div>

      <section class="figures">
        <div>
          <span class="f-label">Discharged</span>
          <span class="f-value">{{ dischargedT.toFixed(1) }}<small> kWh</small></span>
          <span class="f-note">Worth {{ eur(data.totals.valueDischarged) }} at the prices then</span>
        </div>
        <div>
          <span class="f-label">Charged</span>
          <span class="f-value">{{ chargedT.toFixed(1) }}<small> kWh</small></span>
          <span class="f-note">{{ kwh(data.totals.lossKwh, 1) }} lost in conversion</span>
        </div>
      </section>

      <!-- Where the charge came from: one bar split solar / grid -->
      <section class="block">
        <div class="block-head"><h2>Where the charge came from</h2></div>
        <div class="split" role="img" :aria-label="`Solar ${solarShare}%, grid ${100 - solarShare}%`">
          <div class="seg solar" :style="{ flexGrow: data.totals.chargedSolarKwh || 0.0001 }" />
          <div class="seg grid-c" :style="{ flexGrow: data.totals.chargedGridKwh || 0.0001 }" />
        </div>
        <div class="split-legend">
          <span><i class="sw" style="background: var(--sun)" /> Solar <b>{{ solarShare }}%</b> {{ kwh(data.totals.chargedSolarKwh, 1) }}</span>
          <span><i class="sw" style="background: var(--cheap)" /> Grid <b>{{ 100 - solarShare }}%</b> {{ kwh(data.totals.chargedGridKwh, 1) }}</span>
        </div>
      </section>

      <section class="block">
        <div class="block-head"><h2>In and out per {{ period }}</h2></div>
        <div class="chart">
          <BarChart
            :key="`e-${period}`"
            :labels="labels"
            stacked
            unit="kWh"
            :series="[
              { label: 'From solar', data: data.rows.map((r: any) => r.chargedSolarKwh), color: '--c-solar' },
              { label: 'From grid', data: data.rows.map((r: any) => r.chargedGridKwh), color: '--c-grid-charge' },
              { label: 'Discharged', data: data.rows.map((r: any) => -r.dischargedKwh), color: '--c-discharge' },
            ]"
            :format="(v) => kwh(Math.abs(v), 1)"
          />
        </div>
      </section>

      <details class="block disclosure">
        <summary>Every {{ period }} <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ period[0]!.toUpperCase() + period.slice(1) }}</th><th>Solar in</th><th>Grid in</th><th>Out</th><th>Cost in</th><th>Value out</th><th>Saved</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in [...data.rows].reverse()" :key="r.bucket">
                <td>{{ fmtBucket(r.bucket) }}</td>
                <td>{{ r.chargedSolarKwh.toFixed(2) }}</td>
                <td>{{ r.chargedGridKwh.toFixed(2) }}</td>
                <td>{{ r.dischargedKwh.toFixed(2) }}</td>
                <td>{{ eur(basis === 'naive' ? r.costNaive : r.costOpportunity) }}</td>
                <td>{{ eur(r.valueDischarged) }}</td>
                <td>{{ eur(basis === 'naive' ? r.savingNaive : r.savingOpportunity) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>
    <div v-else class="skeleton" style="height: 340px; margin-top: 24px" />
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const periods = [
  { value: 'hour', label: 'Hours' },
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
] as const
const bases = [
  { value: 'naive', label: 'Solar free' },
  { value: 'opportunity', label: 'Solar at feed-in' },
] as const
const period = ref<(typeof periods)[number]['value']>('day')
const basis = ref<'naive' | 'opportunity'>('naive')
const data = ref<any>(null)

watch(period, load, { immediate: true })
async function load() {
  data.value = await api('/api/savings', { query: { period: period.value } })
}

const rangeLabel = computed(() => ({ hour: 'in the last 48 hours', day: 'in the last 31 days', week: 'in the last 17 weeks', month: 'in the last 13 months', year: 'since the start' })[period.value])
const savings = computed(() => (data.value?.rows ?? []).map((r: any) => (basis.value === 'naive' ? r.savingNaive : r.savingOpportunity)))
const savingTotal = computed(() => (basis.value === 'naive' ? data.value?.totals.savingNaive : data.value?.totals.savingOpportunity) ?? 0)
const savingT = useTweened(() => savingTotal.value, { stiffness: 60 })
const dischargedT = useTweened(() => data.value?.totals.dischargedKwh ?? 0, { stiffness: 60 })
const chargedT = useTweened(() => (data.value ? data.value.totals.chargedSolarKwh + data.value.totals.chargedGridKwh : 0), { stiffness: 60 })
const solarShare = computed(() => {
  const t = data.value?.totals
  const all = t ? t.chargedSolarKwh + t.chargedGridKwh : 0
  return all > 0 ? Math.round((t.chargedSolarKwh / all) * 100) : 0
})
const labels = computed(() => (data.value?.rows ?? []).map((r: any) => fmtBucket(r.bucket)))

function fmtBucket(b: string) {
  const [date, t] = b.split('T')
  const [y, m, dd] = date!.split('-')
  if (period.value === 'hour') return `${dd}/${m} ${t}`
  if (period.value === 'month') return `${m}/${y}`
  if (period.value === 'year') return y!
  return `${dd}/${m}`
}
</script>

<style scoped>
.total { margin: 28px 0 14px; }
.t-value { margin: 0; font-size: clamp(56px, 17vw, 80px); line-height: 0.95; font-weight: 650; font-stretch: 75%; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.t-value.neg { color: var(--alert); }
.t-line { margin: 6px 0 0; font-size: 18px; color: var(--text-2); }
.basis { margin-bottom: 20px; }
.basis .hint { margin-top: 6px; }
.chart.saved { margin-bottom: 36px; }
.split { display: flex; gap: 3px; height: 16px; }
.seg { flex-basis: 0; border-radius: 2px; transition: flex-grow 0.9s var(--ease-out); }
.seg.solar { background: var(--sun); }
.seg.grid-c { background: var(--cheap); }
.split-legend { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 12px; margin-top: 10px; font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.split-legend span { display: inline-flex; align-items: center; gap: 6px; }
.split-legend b { color: var(--text); font-weight: 600; }
</style>
