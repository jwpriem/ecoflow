<template>
  <div>
    <header class="page-head"><h1>Savings</h1></header>

    <div class="controls">
      <Segmented v-model="period" :options="periods" full />
      <Segmented v-model="basis" :options="bases" full />
    </div>

    <template v-if="data">
      <section class="card hero rise">
        <div class="label">Saved · {{ rangeLabel }}</div>
        <div class="hero-num" :class="savingTotal >= 0 ? '' : 'neg'">{{ eur(savingT) }}</div>
        <div class="small muted">{{ basis === 'naive' ? 'Solar stored at €0/kWh' : 'Solar stored at the feed-in price you gave up' }}</div>
        <div class="chart" style="margin-top: 14px"><BarChart :key="`s-${period}-${basis}`" :labels="labels" :series="[{ label: 'Saved', data: savings, color: '--c-battery-1' }]" :format="(v) => eur(v)" /></div>
      </section>

      <div class="grid">
        <section class="card rise">
          <div class="label">Discharged</div>
          <div class="big">{{ dischargedT.toFixed(1) }}<small class="unit">kWh</small></div>
          <div class="small muted">worth {{ eur(data.totals.valueDischarged) }}</div>
        </section>
        <section class="card rise">
          <div class="label">Charged</div>
          <div class="big">{{ chargedT.toFixed(1) }}<small class="unit">kWh</small></div>
          <div class="small muted">{{ kwh(data.totals.lossKwh, 1) }} lost</div>
        </section>
      </div>

      <!-- Where the charge came from: one bar split solar / grid -->
      <section class="card rise">
        <div class="card-head"><span class="eyebrow">Charged from</span></div>
        <div class="split" role="img" :aria-label="`Solar ${solarShare}%, grid ${100 - solarShare}%`">
          <div class="seg solar" :style="{ flexGrow: data.totals.chargedSolarKwh || 0.0001 }" />
          <div class="seg grid-c" :style="{ flexGrow: data.totals.chargedGridKwh || 0.0001 }" />
        </div>
        <div class="split-legend">
          <span><i style="background: var(--c-solar)" /> Solar <b>{{ kwh(data.totals.chargedSolarKwh, 1) }}</b> · {{ solarShare }}%</span>
          <span><i style="background: var(--c-grid-charge)" /> Grid <b>{{ kwh(data.totals.chargedGridKwh, 1) }}</b> · {{ 100 - solarShare }}%</span>
        </div>
      </section>

      <section class="card rise">
        <div class="card-head"><span class="eyebrow">Energy per {{ period }}</span></div>
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

      <section class="card rise">
        <details class="disclosure">
          <summary>All {{ period }}s <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
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
        </details>
      </section>
    </template>
    <div v-else class="skeleton" style="height: 340px" />
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const periods = [
  { value: 'hour', label: 'H' },
  { value: 'day', label: 'D' },
  { value: 'week', label: 'W' },
  { value: 'month', label: 'M' },
  { value: 'year', label: 'Y' },
] as const
const bases = [
  { value: 'naive', label: 'Solar at €0' },
  { value: 'opportunity', label: 'Solar at feed-in' },
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
.controls { display: grid; gap: 8px; margin-bottom: 14px; }
.hero-num { font: 600 44px/1.05 var(--font-rounded); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; margin: 4px 0 2px; color: var(--sys-green); }
.hero-num.neg { color: var(--sys-red); }
.unit { font: 500 13px var(--font); color: var(--text-2); margin-left: 4px; letter-spacing: 0; }
.big { font-size: 28px; margin-top: 4px; }
.split { display: flex; gap: 2px; height: 14px; border-radius: 7px; overflow: hidden; }
.seg { flex-basis: 0; transition: flex-grow 0.9s var(--ease-out); }
.seg.solar { background: var(--c-solar); }
.seg.grid-c { background: var(--c-grid-charge); }
.split-legend { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 12px; margin-top: 12px; font-size: 13px; color: var(--text-2); }
.split-legend span { display: inline-flex; align-items: center; gap: 6px; }
.split-legend b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.split-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
</style>
