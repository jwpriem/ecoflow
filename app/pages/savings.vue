<template>
  <div>
    <h1>Savings</h1>
    <div class="row" style="margin-bottom: 16px">
      <div class="segmented">
        <button v-for="p in periods" :key="p.value" :class="{ active: period === p.value }" @click="period = p.value">{{ p.label }}</button>
      </div>
      <div class="segmented">
        <button :class="{ active: basis === 'naive' }" @click="basis = 'naive'">Solar €0</button>
        <button :class="{ active: basis === 'opportunity' }" @click="basis = 'opportunity'">Solar at feed-in</button>
      </div>
    </div>

    <template v-if="data">
      <div class="grid">
        <div class="card">
          <div class="label">Saved · {{ rangeLabel }}</div>
          <div class="big" :class="savingTotal >= 0 ? 'pos' : 'neg'">{{ eur(savingTotal) }}</div>
          <div class="small muted">{{ basis === 'naive' ? 'solar stored at €0/kWh' : 'solar stored at the feed-in price you gave up' }}</div>
        </div>
        <div class="card">
          <div class="label">Discharged</div>
          <div class="big">{{ kwh(data.totals.dischargedKwh, 1) }}</div>
          <div class="small muted">worth {{ eur(data.totals.valueDischarged) }} at the time</div>
        </div>
        <div class="card">
          <div class="label">Charged</div>
          <div class="big">{{ kwh(data.totals.chargedSolarKwh + data.totals.chargedGridKwh, 1) }}</div>
          <div class="small muted">{{ kwh(data.totals.chargedSolarKwh, 1) }} solar · {{ kwh(data.totals.chargedGridKwh, 1) }} grid · {{ kwh(data.totals.lossKwh, 1) }} lost</div>
        </div>
      </div>

      <div class="card">
        <h2>Saved per {{ period }}</h2>
        <BarChart :labels="labels" :series="[{ label: 'Saved', data: savings, color: '--series-1' }]" :format="(v) => eur(v)" />
      </div>

      <div class="card">
        <h2>Energy per {{ period }}</h2>
        <BarChart
          :labels="labels"
          stacked
          unit="kWh"
          :series="[
            { label: 'Charged from grid', data: data.rows.map((r: any) => r.chargedGridKwh), color: '--series-1' },
            { label: 'Charged from solar', data: data.rows.map((r: any) => r.chargedSolarKwh), color: '--series-2' },
            { label: 'Discharged', data: data.rows.map((r: any) => -r.dischargedKwh), color: '--series-3' },
          ]"
          :format="(v) => kwh(Math.abs(v), 1)"
        />
      </div>

      <div class="card">
        <h2>Table</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ period }}</th><th>Solar in</th><th>Grid in</th><th>Out</th><th>Cost in</th><th>Value out</th><th>Saved</th></tr>
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
      </div>
    </template>
    <p v-else class="muted">Loading…</p>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const periods = [
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const
const period = ref<(typeof periods)[number]['value']>('day')
const basis = ref<'naive' | 'opportunity'>('naive')
const data = ref<any>(null)

watch(period, load, { immediate: true })
async function load() {
  data.value = await api('/api/savings', { query: { period: period.value } })
}

const rangeLabel = computed(() => ({ hour: 'last 48 hours', day: 'last 31 days', week: 'last 120 days', month: 'last 13 months', year: 'all years' })[period.value])
const savings = computed(() => (data.value?.rows ?? []).map((r: any) => (basis.value === 'naive' ? r.savingNaive : r.savingOpportunity)))
const savingTotal = computed(() => (basis.value === 'naive' ? data.value?.totals.savingNaive : data.value?.totals.savingOpportunity) ?? 0)
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
