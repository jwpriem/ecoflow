<template>
  <div>
    <header class="page-head"><h1>{{ m.savings.title }}</h1></header>

    <Segmented v-model="period" :options="periods" full :aria-label="m.savings.periodAria" />
    <div class="source"><Segmented v-model="source" :options="sources" full :aria-label="m.savings.sourceAria" /></div>

    <template v-if="data && !hasRows">
      <section class="nothing">
        <h2>{{ m.savings.nothing }}</h2>
        <p v-if="source === 'battery'">{{ m.savings.nothingBattery }}</p>
        <p v-else-if="source === 'solar'">{{ m.savings.nothingSolar }}</p>
        <p v-else>{{ m.savings.nothingTotal }}</p>
      </section>
    </template>
    <template v-else-if="data">
      <section class="total">
        <p class="t-value" :class="{ neg: headline < 0 }">{{ eur(headlineT) }}</p>
        <p class="t-line">{{ source === 'solar' ? solarLine : source === 'battery' ? m.savings.byBatteries : m.savings.inTotal }} {{ rangeLabel }}</p>
      </section>

      <div class="basis">
        <Segmented v-model="basis" :options="bases" :aria-label="m.savings.basisAria" />
        <p class="hint">{{ basisHint }}</p>
      </div>

      <!-- Batteries -->
      <template v-if="source === 'battery'">
        <div class="chart saved"><BarChart :key="`s-${period}-${basis}`" :labels="labels" :series="[{ label: m.savings.saved, data: savings, color: '--c-battery-1', colors: savings.map((v: number) => (v < 0 ? '--alert' : '--text')) }]" :legend="false" :format="(v) => eur(v)" /></div>

        <section class="figures">
          <div>
            <span class="f-label">{{ m.savings.discharged }}</span>
            <span class="f-value">{{ num(dischargedT, 1) }}<small> kWh</small></span>
            <span class="f-note">{{ m.savings.worthThen(eur(data.totals.valueDischarged)) }}</span>
          </div>
          <div>
            <span class="f-label">{{ m.savings.charged }}</span>
            <span class="f-value">{{ num(chargedT, 1) }}<small> kWh</small></span>
            <span class="f-note">{{ m.savings.lost(kwh(data.totals.lossKwh, 1)) }}</span>
          </div>
        </section>

        <!-- Where the charge came from: one bar split solar / grid -->
        <section v-if="chargedTotal > 0" class="block">
          <div class="block-head"><h2>{{ m.savings.chargeFrom }}</h2></div>
          <div class="split" role="img" :aria-label="m.savings.splitAria(solarShare, 100 - solarShare)">
            <div class="seg" style="background: var(--sun)" :style="{ flexGrow: data.totals.chargedSolarKwh || 0.0001 }" />
            <div class="seg" style="background: var(--cheap)" :style="{ flexGrow: data.totals.chargedGridKwh || 0.0001 }" />
          </div>
          <div class="split-legend">
            <span><i class="sw" style="background: var(--sun)" /> {{ m.savings.solar }} <b>{{ solarShare }}%</b> {{ kwh(data.totals.chargedSolarKwh, 1) }}</span>
            <span><i class="sw" style="background: var(--cheap)" /> {{ m.savings.grid }} <b>{{ 100 - solarShare }}%</b> {{ kwh(data.totals.chargedGridKwh, 1) }}</span>
          </div>
        </section>

        <section class="block">
          <div class="block-head"><h2>{{ m.savings.inOut[period] }}</h2></div>
          <div class="chart">
            <BarChart
              :key="`e-${period}`"
              :labels="labels"
              stacked
              unit="kWh"
              :series="[
                { label: m.savings.fromSolar, data: data.rows.map((r: any) => r.chargedSolarKwh), color: '--c-solar' },
                { label: m.savings.fromGrid, data: data.rows.map((r: any) => r.chargedGridKwh), color: '--c-grid-charge' },
                { label: m.savings.discharged, data: data.rows.map((r: any) => -r.dischargedKwh), color: '--c-discharge' },
              ]"
              :format="(v) => kwh(Math.abs(v), 1)"
            />
          </div>
        </section>

        <details class="block disclosure">
          <summary>{{ m.savings.every[period] }} <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ periodTitle }}</th><th>{{ m.savings.cols.solarIn }}</th><th>{{ m.savings.cols.gridIn }}</th><th>{{ m.savings.cols.out }}</th><th>{{ m.savings.cols.costIn }}</th><th>{{ m.savings.cols.valueOut }}</th><th>{{ m.savings.cols.saved }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in [...data.rows].reverse()" :key="r.bucket">
                  <td>{{ fmtBucket(r.bucket) }}</td>
                  <td>{{ num(r.chargedSolarKwh) }}</td>
                  <td>{{ num(r.chargedGridKwh) }}</td>
                  <td>{{ num(r.dischargedKwh) }}</td>
                  <td>{{ eur(basis === 'naive' ? r.costNaive : r.costOpportunity) }}</td>
                  <td>{{ eur(r.valueDischarged) }}</td>
                  <td>{{ eur(batterySaving(r)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>

      <!-- Solar -->
      <template v-else-if="source === 'solar'">
        <div class="basis">
          <Segmented :model-value="solarCount" :options="solarCounts" :aria-label="m.savings.solarCountAria" @update:model-value="setSolarCount" />
        </div>
        <div class="chart saved">
          <BarChart
            :key="`ss-${period}-${basis}-${solarCount}`"
            :labels="labels"
            stacked
            :series="solarSeries"
            :format="(v) => eur(v)"
          />
        </div>

        <section class="figures">
          <div>
            <span class="f-label">{{ m.savings.produced }}</span>
            <span class="f-value">{{ num(producedT, 1) }}<small> kWh</small></span>
            <span class="f-note">{{ m.savings.asMeasured }}</span>
          </div>
          <div>
            <span class="f-label">{{ m.savings.usedStraight }}</span>
            <span class="f-value">{{ num(selfUsedT, 1) }}<small> kWh</small></span>
            <span class="f-note">{{ m.savings.worthThen(eur(data.solar.totals.valueSelfUsed)) }}</span>
          </div>
        </section>

        <section v-if="data.solar.totals.producedKwh > 0" class="block">
          <div class="block-head"><h2>{{ m.savings.solarWent }}</h2></div>
          <div class="split" role="img" :aria-label="m.savings.solarSplitAria(share('selfUsedKwh'), share('exportedKwh'), share('toBatteryKwh'))">
            <div class="seg" style="background: var(--own)" :style="{ flexGrow: data.solar.totals.selfUsedKwh || 0.0001 }" />
            <div class="seg" style="background: var(--import)" :style="{ flexGrow: data.solar.totals.exportedKwh || 0.0001 }" />
            <div class="seg" style="background: var(--text)" :style="{ flexGrow: data.solar.totals.toBatteryKwh || 0.0001 }" />
          </div>
          <div class="split-legend">
            <span><i class="sw" style="background: var(--own)" /> {{ m.savings.house }} <b>{{ share('selfUsedKwh') }}%</b> {{ kwh(data.solar.totals.selfUsedKwh, 1) }}</span>
            <span><i class="sw" style="background: var(--import)" /> {{ m.savings.grid }} <b>{{ share('exportedKwh') }}%</b> {{ kwh(data.solar.totals.exportedKwh, 1) }}</span>
            <span><i class="sw" style="background: var(--text)" /> {{ m.savings.batteries }} <b>{{ share('toBatteryKwh') }}%</b> {{ kwh(data.solar.totals.toBatteryKwh, 1) }}</span>
          </div>
        </section>

        <details class="block disclosure">
          <summary>{{ m.savings.every[period] }} <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ periodTitle }}</th><th>{{ m.savings.cols.produced }}</th><th>{{ m.savings.cols.house }}</th><th>{{ m.savings.cols.grid }}</th><th>{{ m.savings.cols.batteries }}</th><th>{{ m.savings.cols.earned }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in [...data.solar.rows].reverse()" :key="r.bucket">
                  <td>{{ fmtBucket(r.bucket) }}</td>
                  <td>{{ num(r.producedKwh) }}</td>
                  <td>{{ num(r.selfUsedKwh) }}</td>
                  <td>{{ num(r.exportedKwh) }}</td>
                  <td>{{ num(r.toBatteryKwh) }}</td>
                  <td>{{ eur(solarSaving(r)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>

      <!-- Total -->
      <template v-else>
        <div class="chart saved">
          <BarChart
            :key="`t-${period}-${basis}-${solarCount}`"
            :labels="labels"
            stacked
            :series="[
              { label: m.savings.batteries, data: buckets.map((b) => batterySaving(batteryBy.get(b))), color: '--c-battery-1' },
              { label: m.savings.solar, data: buckets.map((b) => solarSaving(solarBy.get(b))), color: '--c-solar' },
            ]"
            :format="(v) => eur(v)"
          />
        </div>

        <section class="figures">
          <div>
            <span class="f-label">{{ m.savings.batteries }}</span>
            <span class="f-value" :class="{ neg: batteryTotal < 0 }">{{ eur(batteryTotalT) }}</span>
            <span class="f-note">{{ m.savings.batteriesHelp }}</span>
          </div>
          <div>
            <span class="f-label">{{ m.savings.solar }}</span>
            <span class="f-value">{{ eur(solarTotalT) }}</span>
            <span class="f-note">{{ solarHelp }}</span>
          </div>
        </section>
      </template>
    </template>
    <LoadError v-else-if="error" :error="error" :what="m.load.what.savings" :busy="loading" @retry="load" />
    <div v-else class="skeleton" style="height: 340px; margin-top: 24px" />
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const { m } = useLocale()
type Period = 'hour' | 'day' | 'week' | 'month' | 'year'
type Source = 'battery' | 'solar' | 'total'
const PERIODS: Period[] = ['hour', 'day', 'week', 'month', 'year']
const SOURCES: Source[] = ['battery', 'solar', 'total']
const periods = computed(() => PERIODS.map((value) => ({ value, label: m.value.savings.periods[value] })))
const sources = computed(() => SOURCES.map((value) => ({ value, label: m.value.savings.sources[value] })))
const bases = computed(() => (['naive', 'opportunity'] as const).map((value) => ({ value, label: m.value.savings.bases[value] })))
const period = ref<Period>('day')
const source = ref<Source>('battery')
const basis = ref<'naive' | 'opportunity'>('naive')
const data = ref<any>(null)
const error = ref<any>(null)
const loading = ref(false)

watch(period, load, { immediate: true })
async function load() {
  loading.value = true
  try {
    data.value = await api('/api/savings', { query: { period: period.value } })
    error.value = null
  } catch (e) {
    data.value = null
    error.value = e
  } finally {
    loading.value = false
  }
}

/*
 * Solar that goes into the batteries is counted once. "Solar free": it costs the batteries nothing, so its
 * value shows up in the battery saving when it comes out. "Solar at feed-in": the batteries pay the feed-in
 * price for it and solar earns that price. Either way the total is the same.
 */
const batterySaving = (r: any) => (r ? (basis.value === 'naive' ? r.savingNaive : r.savingOpportunity) : 0)
const { count: solarCount, setCount: setSolarCount, solarValue } = useSolarCount()
const solarCounts = computed(() => SOLAR_COUNTS.map((value) => ({ value, label: m.value.solarCount[value].short })))
const solarHelp = computed(() => m.value.solarCount[solarCount.value].help)
const solarSaving = (r: any) => solarValue(r, basis.value === 'opportunity')

const batteryBy = computed(() => new Map<string, any>((data.value?.rows ?? []).map((r: any) => [r.bucket, r])))
const solarBy = computed(() => new Map<string, any>((data.value?.solar?.rows ?? []).map((r: any) => [r.bucket, r])))
const buckets = computed(() => {
  if (source.value === 'battery') return [...batteryBy.value.keys()]
  if (source.value === 'solar') return [...solarBy.value.keys()]
  return [...new Set([...batteryBy.value.keys(), ...solarBy.value.keys()])].sort()
})
const hasRows = computed(() => buckets.value.length > 0)
const labels = computed(() => buckets.value.map(fmtBucket))

const batteryTotal = computed(() => (data.value ? batterySaving(data.value.totals) : 0))
const solarTotal = computed(() => (data.value?.solar ? solarSaving(data.value.solar.totals) : 0))
const headline = computed(() => (source.value === 'battery' ? batteryTotal.value : source.value === 'solar' ? solarTotal.value : batteryTotal.value + solarTotal.value))
const headlineT = useTweened(() => headline.value, { stiffness: 60 })
const batteryTotalT = useTweened(() => batteryTotal.value, { stiffness: 60 })
const solarTotalT = useTweened(() => solarTotal.value, { stiffness: 60 })

const solarLine = computed(() => m.value.savings.solarLine[solarCount.value])
const basisHint = computed(() => {
  if (source.value === 'solar') {
    return basis.value === 'naive' ? m.value.savings.hintSolarNaive : m.value.savings.hintSolarOpp
  }
  return basis.value === 'naive' ? m.value.savings.hintNaive : m.value.savings.hintOpp
})

const savings = computed(() => (data.value?.rows ?? []).map(batterySaving))
const solarSeries = computed(() => {
  const rows = buckets.value.map((b) => solarBy.value.get(b))
  const series: { label: string; data: number[]; color: string }[] = []
  if (solarCount.value !== 'fed_in') series.push({ label: m.value.savings.usedInHouse, data: rows.map((r) => r?.valueSelfUsed ?? 0), color: '--own' })
  if (solarCount.value !== 'house') series.push({ label: m.value.savings.fedIn, data: rows.map((r) => r?.valueExported ?? 0), color: '--import' })
  if (basis.value === 'opportunity') series.push({ label: m.value.savings.intoBatteries, data: rows.map((r) => r?.valueToBattery ?? 0), color: '--c-battery-1' })
  return series
})
const share = (k: 'selfUsedKwh' | 'exportedKwh' | 'toBatteryKwh') => {
  const t = data.value?.solar?.totals
  return t?.producedKwh > 0 ? Math.round((t[k] / t.producedKwh) * 100) : 0
}

const rangeLabel = computed(() => m.value.savings.range[period.value])
const periodTitle = computed(() => m.value.savings.periodTitle[period.value])
const dischargedT = useTweened(() => data.value?.totals.dischargedKwh ?? 0, { stiffness: 60 })
const chargedT = useTweened(() => (data.value ? data.value.totals.chargedSolarKwh + data.value.totals.chargedGridKwh : 0), { stiffness: 60 })
const producedT = useTweened(() => data.value?.solar?.totals.producedKwh ?? 0, { stiffness: 60 })
const selfUsedT = useTweened(() => data.value?.solar?.totals.selfUsedKwh ?? 0, { stiffness: 60 })
const chargedTotal = computed(() => (data.value ? data.value.totals.chargedSolarKwh + data.value.totals.chargedGridKwh : 0))
const solarShare = computed(() => {
  const t = data.value?.totals
  const all = t ? t.chargedSolarKwh + t.chargedGridKwh : 0
  return all > 0 ? Math.round((t.chargedSolarKwh / all) * 100) : 0
})

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
.source { margin-top: 10px; }
.nothing { margin: 28px 0 0; }
.nothing h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.nothing p { margin: 0; color: var(--text-2); max-width: 46ch; }
.total { margin: 28px 0 14px; }
.t-value { margin: 0; font-size: clamp(56px, 17vw, 80px); line-height: 0.95; font-weight: 650; font-stretch: 75%; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.t-value.neg { color: var(--alert); }
.t-line { margin: 6px 0 0; font-size: 18px; color: var(--text-2); }
.basis { margin-bottom: 20px; }
.basis .hint { margin-top: 6px; }
.chart.saved { margin-bottom: 36px; }
.split { display: flex; gap: 3px; height: 16px; }
.seg { flex-basis: 0; border-radius: 2px; transition: flex-grow 0.9s var(--ease-out); }
.split-legend { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 12px; margin-top: 10px; font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.split-legend span { display: inline-flex; align-items: center; gap: 6px; }
.split-legend b { color: var(--text); font-weight: 600; }
</style>
