<template>
  <div>
    <header class="page-head" :class="{ sub: detail }">
      <button v-if="detail" type="button" class="plain back" @click="detail = null"><AppIcon name="chevron" class="flip" />{{ m.savings.back }}</button>
      <h1>{{ detail ? m.savings.sources[detail] : m.savings.title }}</h1>
    </header>

    <!-- One period at a time: step back and forth through weeks, months or years -->
    <div class="period">
      <div class="stepper">
        <button type="button" class="step" :aria-label="m.savings.prev" :disabled="!canGoBack" @click="move(-1)"><AppIcon name="chevron" class="flip" /></button>
        <span class="p-name" aria-live="polite">{{ rangeName }}<small v-if="span === 'week'">{{ weekDates }}</small></span>
        <button type="button" class="step" :aria-label="m.savings.next" :disabled="current" @click="move(1)"><AppIcon name="chevron" /></button>
      </div>
      <Segmented v-model="span" :options="spans" :aria-label="m.savings.spanAria" />
    </div>

    <template v-if="data && !hasRows">
      <section class="nothing">
        <h2>{{ current && !prevHasRows ? m.savings.nothing : m.savings.nothingIn(phrase) }}</h2>
        <p>{{ current && !prevHasRows ? m.savings.nothingTotal : !current ? m.savings.nothingEarlier : '' }}</p>
      </section>
    </template>

    <template v-else-if="data">
      <!-- The answer first -->
      <section class="total">
        <p class="t-value" :class="{ neg: headline < 0 }">{{ eur(headlineT) }}</p>
        <p class="t-line">{{ heroLine }}</p>
        <p v-if="delta" class="t-delta" :class="delta.up ? 'pos' : 'muted'">
          <span aria-hidden="true">{{ delta.up ? '↑' : '↓' }}</span>
          {{ delta.up ? m.savings.more(eur(delta.abs), delta.than) : m.savings.less(eur(delta.abs), delta.than) }}
        </p>
        <p v-if="projected != null" class="t-proj">{{ m.savings.onTrack(eur(projected, 0), span) }}</p>
      </section>

      <section class="chart-block">
        <p class="readout" aria-live="polite">
          <template v-if="pickedSlot">
            <b>{{ pickedSlot.title }}</b>
            <span class="num">{{ eur(pickedSlot.battery + pickedSlot.solar) }}</span>
            <span v-if="!detail" class="muted">{{ m.savings.readout(eur(pickedSlot.battery), eur(pickedSlot.solar)) }}</span>
          </template>
        </p>
        <SavingsChart
          v-model="selected" :slots="chartSlots" :ticks="ticks" :average="average" :format="(v) => eur(v, v % 1 ? 2 : 0)"
          :aria="m.savings.chartAria(rangeName, eur(headline))"
        />
        <ul class="legend">
          <li v-if="detail !== 'solar'"><i class="sw" style="background: var(--text)" />{{ m.savings.batteries }}</li>
          <li v-if="detail !== 'battery'"><i class="sw" style="background: var(--sun)" />{{ m.savings.solar }}</li>
          <li v-if="average != null"><i class="avg-sw" />{{ m.savings.average(eur(average), bucket) }}</li>
        </ul>
      </section>

      <!-- Overview: what saved it, each row opens its detail -->
      <section v-if="!detail" class="block">
        <div class="block-head where"><h2>{{ m.savings.where }}</h2></div>
        <div class="sources">
          <button v-if="data.rows.length" type="button" class="src" @click="open('battery')">
            <i class="dot" style="background: var(--text)" />
            <span class="s-main">
              <span class="s-name">{{ m.savings.batteries }}</span>
              <span class="s-sum">{{ m.savings.batterySummary(kwh(data.totals.dischargedKwh, 0), kwh(chargedTotal, 0), chargedSolarPct) }}</span>
              <span class="share" role="img" :aria-label="m.savings.shareAria(share(batteryTotal))"><i :style="{ width: `${share(batteryTotal)}%`, background: 'var(--text)' }" /></span>
            </span>
            <span class="s-value num" :class="{ neg: batteryTotal < 0 }">{{ eur(batteryTotal) }}</span>
            <AppIcon name="chevron" class="chev" />
          </button>
          <button v-if="data.solar.rows.length" type="button" class="src" @click="open('solar')">
            <i class="dot" style="background: var(--sun)" />
            <span class="s-main">
              <span class="s-name">{{ m.savings.solar }}</span>
              <span class="s-sum">{{ m.savings.solarSummary(kwh(data.solar.totals.producedKwh, 0), solarPct('selfUsedKwh')) }}</span>
              <span class="share" role="img" :aria-label="m.savings.shareAria(share(solarTotal))"><i :style="{ width: `${share(solarTotal)}%`, background: 'var(--sun)' }" /></span>
            </span>
            <span class="s-value num">{{ eur(solarTotal) }}</span>
            <AppIcon name="chevron" class="chev" />
          </button>
        </div>
      </section>

      <!-- Batteries in detail -->
      <template v-else-if="detail === 'battery'">
        <div class="pair">
          <section class="figures">
            <div>
              <span class="f-label">{{ m.savings.discharged }}</span>
              <span class="f-value">{{ num(data.totals.dischargedKwh, 1) }}<small> kWh</small></span>
              <span class="f-note">{{ m.savings.worthThen(eur(data.totals.valueDischarged)) }}</span>
            </div>
            <div>
              <span class="f-label">{{ m.savings.charged }}</span>
              <span class="f-value">{{ num(chargedTotal, 1) }}<small> kWh</small></span>
              <span class="f-note">{{ m.savings.lost(kwh(Math.max(0, data.totals.lossKwh), 1)) }}</span>
            </div>
          </section>

          <section v-if="chargedTotal > 0" class="block">
            <div class="block-head"><h2>{{ m.savings.chargeFrom }}</h2></div>
            <div class="split" role="img" :aria-label="m.savings.splitAria(chargedSolarPct, 100 - chargedSolarPct)">
              <div class="seg" style="background: var(--sun)" :style="{ flexGrow: data.totals.chargedSolarKwh || 0.0001 }" />
              <div class="seg" style="background: var(--cheap)" :style="{ flexGrow: data.totals.chargedGridKwh || 0.0001 }" />
            </div>
            <div class="split-legend">
              <span><i class="sw" style="background: var(--sun)" /> {{ m.savings.solar }} <b>{{ chargedSolarPct }}%</b> {{ kwh(data.totals.chargedSolarKwh, 1) }}</span>
              <span><i class="sw" style="background: var(--cheap)" /> {{ m.savings.grid }} <b>{{ 100 - chargedSolarPct }}%</b> {{ kwh(data.totals.chargedGridKwh, 1) }}</span>
            </div>
          </section>
        </div>

        <section class="block">
          <div class="block-head"><h2>{{ m.savings.inOut[bucket] }}</h2></div>
          <div class="chart">
            <BarChart
              :key="`e-${rangeKey}`"
              :labels="data.rows.map((r: any) => fmtBucket(r.bucket))"
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
          <summary>{{ m.savings.every[bucket] }} <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ m.savings.periodTitle[bucket] }}</th><th>{{ m.savings.cols.solarIn }}</th><th>{{ m.savings.cols.gridIn }}</th><th>{{ m.savings.cols.out }}</th><th>{{ m.savings.cols.costIn }}</th><th>{{ m.savings.cols.valueOut }}</th><th>{{ m.savings.cols.saved }}</th></tr>
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

      <!-- Solar in detail -->
      <template v-else>
        <div class="pair">
          <section class="figures">
            <div>
              <span class="f-label">{{ m.savings.produced }}</span>
              <span class="f-value">{{ num(data.solar.totals.producedKwh, 1) }}<small> kWh</small></span>
              <span class="f-note">{{ m.savings.asMeasured }}</span>
            </div>
            <div>
              <span class="f-label">{{ m.savings.usedStraight }}</span>
              <span class="f-value">{{ num(data.solar.totals.selfUsedKwh, 1) }}<small> kWh</small></span>
              <span class="f-note">{{ m.savings.worthThen(eur(data.solar.totals.valueSelfUsed)) }}</span>
            </div>
          </section>

          <section v-if="data.solar.totals.producedKwh > 0" class="block">
            <div class="block-head"><h2>{{ m.savings.solarWent }}</h2></div>
            <div class="split" role="img" :aria-label="m.savings.solarSplitAria(solarPct('selfUsedKwh'), solarPct('exportedKwh'), solarPct('toBatteryKwh'))">
              <div class="seg" style="background: var(--own)" :style="{ flexGrow: data.solar.totals.selfUsedKwh || 0.0001 }" />
              <div class="seg" style="background: var(--import)" :style="{ flexGrow: data.solar.totals.exportedKwh || 0.0001 }" />
              <div class="seg" style="background: var(--text)" :style="{ flexGrow: data.solar.totals.toBatteryKwh || 0.0001 }" />
            </div>
            <div class="split-legend">
              <span><i class="sw" style="background: var(--own)" /> {{ m.savings.house }} <b>{{ solarPct('selfUsedKwh') }}%</b> {{ kwh(data.solar.totals.selfUsedKwh, 1) }}</span>
              <span><i class="sw" style="background: var(--import)" /> {{ m.savings.grid }} <b>{{ solarPct('exportedKwh') }}%</b> {{ kwh(data.solar.totals.exportedKwh, 1) }}</span>
              <span><i class="sw" style="background: var(--text)" /> {{ m.savings.batteries }} <b>{{ solarPct('toBatteryKwh') }}%</b> {{ kwh(data.solar.totals.toBatteryKwh, 1) }}</span>
            </div>
          </section>
        </div>

        <details class="block disclosure">
          <summary>{{ m.savings.every[bucket] }} <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>{{ m.savings.periodTitle[bucket] }}</th><th>{{ m.savings.cols.produced }}</th><th>{{ m.savings.cols.house }}</th><th>{{ m.savings.cols.grid }}</th><th>{{ m.savings.cols.batteries }}</th><th>{{ m.savings.cols.earned }}</th></tr>
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

      <!-- Overview table: every day or month in the period -->
      <details v-if="!detail" class="block disclosure">
        <summary>{{ m.savings.every[bucket] }} <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>{{ m.savings.periodTitle[bucket] }}</th><th>{{ m.savings.cols.batteries }}</th><th>{{ m.savings.cols.solar }}</th><th>{{ m.savings.cols.total }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="k in [...bookedKeys].reverse()" :key="k">
                <td>{{ fmtBucket(k) }}</td>
                <td>{{ eur(batterySaving(batteryBy.get(k))) }}</td>
                <td>{{ eur(solarSaving(solarBy.get(k))) }}</td>
                <td>{{ eur(batterySaving(batteryBy.get(k)) + solarSaving(solarBy.get(k))) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>
    <LoadError v-else-if="error" :error="error" :what="m.load.what.savings" :busy="loading" @retry="load" />
    <div v-else class="skeleton" style="height: 340px; margin-top: 24px" />

    <!-- The two choices that change how savings are counted; most people set them once -->
    <details v-if="data" class="block disclosure how">
      <summary>
        {{ m.savings.howWeCount }}
        <span class="how-now">{{ m.savings.basisShort[basis] }} · {{ m.solarCount[solarCount].label }} <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></span>
      </summary>
      <div class="list">
        <label class="list-row">
          <span class="title">{{ m.savings.storedSolar }}</span>
          <select v-model="basis">
            <option v-for="b in BASES" :key="b" :value="b">{{ m.savings.basisShort[b] }}</option>
          </select>
        </label>
        <label class="list-row">
          <span class="title">{{ m.savings.solarCounts }}</span>
          <select :value="solarCount" @change="setSolarCount(($event.target as HTMLSelectElement).value as SolarCount)">
            <option v-for="c in SOLAR_COUNTS" :key="c" :value="c">{{ m.solarCount[c].label }}</option>
          </select>
        </label>
      </div>
      <p class="hint">{{ basis === 'naive' ? m.savings.hintNaive : m.savings.hintOpp }} {{ m.solarCount[solarCount].help }}.</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { SolarCount } from '~/composables/useSolarCount'
import type { Range, Span } from '~/utils/savingsPeriod'

const api = useApi()
const { m, dayLabel } = useLocale()

type Basis = 'naive' | 'opportunity'
type Source = 'battery' | 'solar'
const BASES: readonly Basis[] = ['naive', 'opportunity']

const spans = computed(() => SPANS.map((value) => ({ value, label: m.value.savings.spans[value] })))
const span = ref<Span>('month')
const now = ref(new Date())
const range = shallowRef<Range>(rangeOf('month', now.value))
const detail = ref<Source | null>(null)
const data = ref<any>(null)
const prevData = ref<any>(null)
const comparison = ref<ReturnType<typeof comparisonOf> | null>(null)
const error = ref<any>(null)
const loading = ref(false)
const selected = ref(-1)

const bucket = computed(() => bucketOf(span.value))
const current = computed(() => rangeIsCurrent(range.value, now.value))
const rangeKey = computed(() => `${span.value}-${range.value.start.getTime()}`)

// Changing the length starts again at the period you're in
watch(span, (s) => (range.value = rangeOf(s, new Date())))
watch(range, load, { immediate: true })
function move(n: number) {
  range.value = shiftRange(range.value, n)
}

async function load() {
  const r = range.value
  now.value = new Date()
  const cmp = comparisonOf(r, now.value)
  const period = bucketOf(r.span)
  loading.value = true
  try {
    const [cur, prev] = await Promise.all([
      api('/api/savings', { query: { period, from: r.start.toISOString(), to: r.end.toISOString() } }),
      // The comparison is extra: without it the page still says what was saved
      api('/api/savings', { query: { period, from: cmp.from.toISOString(), to: cmp.to.toISOString() } }).catch(() => null),
    ])
    if (r !== range.value) return
    data.value = cur
    prevData.value = prev
    comparison.value = cmp
    error.value = null
    selected.value = defaultSelected()
  } catch (e) {
    if (r !== range.value) return
    data.value = null
    error.value = e
  } finally {
    loading.value = false
  }
}

/*
 * Solar that goes into the batteries is counted once. "Free": it costs the batteries nothing, so its
 * value shows up in the battery saving when it comes out. "At the feed-in price": the batteries pay the
 * feed-in price for it and solar earns that price. Either way the total is the same. Stored on this device.
 */
const BASIS_KEY = 'savings.basis'
const basis = useState<Basis>('savings-basis', () => {
  try {
    return localStorage.getItem(BASIS_KEY) === 'opportunity' ? 'opportunity' : 'naive'
  } catch {
    return 'naive'
  }
})
watch(basis, (b) => {
  try {
    localStorage.setItem(BASIS_KEY, b)
  } catch {
    // Private mode or storage blocked: the choice still holds for this session
  }
})
const batterySaving = (r: any) => (r ? (basis.value === 'naive' ? r.savingNaive : r.savingOpportunity) : 0)
const { count: solarCount, setCount: setSolarCount, solarValue } = useSolarCount()
const solarSaving = (r: any) => solarValue(r, basis.value === 'opportunity')

const batteryBy = computed(() => new Map<string, any>((data.value?.rows ?? []).map((r: any) => [r.bucket, r])))
const solarBy = computed(() => new Map<string, any>((data.value?.solar?.rows ?? []).map((r: any) => [r.bucket, r])))
const bookedKeys = computed(() => [...new Set([...batteryBy.value.keys(), ...solarBy.value.keys()])].sort())
const hasRows = computed(() => bookedKeys.value.length > 0)
const prevHasRows = computed(() => !!(prevData.value?.rows?.length || prevData.value?.solar?.rows?.length))
// Going back stops where nothing was booked any more
const canGoBack = computed(() => hasRows.value || prevHasRows.value)

const totalsOf = (d: any) => ({ battery: d ? batterySaving(d.totals) : 0, solar: d?.solar ? solarSaving(d.solar.totals) : 0 })
const pick = (t: { battery: number; solar: number }) => (detail.value === 'battery' ? t.battery : detail.value === 'solar' ? t.solar : t.battery + t.solar)
const batteryTotal = computed(() => totalsOf(data.value).battery)
const solarTotal = computed(() => totalsOf(data.value).solar)
const headline = computed(() => pick(totalsOf(data.value)))
const headlineT = useTweened(() => headline.value, { stiffness: 60 })

// Names for the period
const locale = computed(() => m.value.dateLocale)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const monthName = (d: Date) => d.toLocaleDateString(locale.value, { month: 'long' })
const shortDate = (d: Date) => d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
const rangeName = computed(() => {
  const s = range.value.start
  if (span.value === 'week') return m.value.savings.weekName(isoWeek(s))
  if (span.value === 'month') return cap(s.toLocaleDateString(locale.value, { month: 'long', year: 'numeric' }))
  return String(s.getFullYear())
})
const weekDates = computed(() => {
  const { start, end } = range.value
  return ` ${start.getDate()}–${shortDate(new Date(end.getTime() - 1))}`
})
const phrase = computed(() => {
  const s = range.value.start
  const p = m.value.savings.phrase
  if (span.value === 'week') return current.value ? p.thisWeek : p.week(isoWeek(s))
  if (span.value === 'month') return p.month(monthName(s))
  return p.year(s.getFullYear())
})
const heroLine = computed(() => {
  const lead = detail.value === 'battery' ? m.value.savings.byBatteries : detail.value === 'solar' ? m.value.savings.solarLine[solarCount.value] : m.value.savings.saved
  return `${lead} ${phrase.value}${current.value ? m.value.savings.soFar : ''}`
})

// Against the period before; while this one runs, against the same stretch of it
const delta = computed(() => {
  const c = comparison.value
  if (!c || !prevHasRows.value) return null
  const diff = headline.value - pick(totalsOf(prevData.value))
  if (Math.abs(diff) < 0.005) return null
  const last = new Date(c.to.getTime() - 1)
  const t = m.value.savings.than
  const than =
    span.value === 'week' ? (c.partial ? t.lastWeekSoFar : t.lastWeek)
      : span.value === 'month' ? (c.partial ? `${c.from.getDate()}–${shortDate(last)}` : monthName(c.from))
        : c.partial ? t.yearUpTo(c.from.getFullYear(), shortDate(last)) : String(c.from.getFullYear())
  return { up: diff > 0, abs: Math.abs(diff), than }
})
const projected = computed(() => {
  const p = projectTotal(headline.value, range.value, now.value)
  return p != null && headline.value > 0 ? p : null
})

// The chart: every day (or month) of the period, the ones still to come as stubs
const slotDates = computed(() => slotsOf(range.value))
const chartSlots = computed(() =>
  slotDates.value.map((d) => {
    const k = bucketKey(d)
    return {
      label: tickLabel(d),
      battery: detail.value === 'solar' ? 0 : batterySaving(batteryBy.value.get(k)),
      solar: detail.value === 'battery' ? 0 : solarSaving(solarBy.value.get(k)),
      future: d > now.value,
    }
  }),
)
function tickLabel(d: Date) {
  if (span.value === 'week') return d.toLocaleDateString(locale.value, { weekday: 'short' })
  if (span.value === 'month') return String(d.getDate())
  return d.toLocaleDateString(locale.value, { month: 'short' }).replace('.', '')
}
const ticks = computed(() => {
  const n = slotDates.value.length
  if (span.value === 'week') return [...Array(n).keys()]
  if (span.value === 'month') return [0, 7, 14, 21, n - 1]
  return [0, 2, 4, 6, 8, 10]
})
const average = computed(() => {
  const past = chartSlots.value.filter((s) => !s.future)
  return past.length >= 2 ? past.reduce((a, s) => a + s.battery + s.solar, 0) / past.length : null
})
function defaultSelected() {
  const slots = slotDates.value
  if (current.value) return slots.findLastIndex((d) => d <= now.value)
  const last = slots.findLastIndex((d) => bookedKeys.value.includes(bucketKey(d)))
  return last >= 0 ? last : slots.length - 1
}
const pickedSlot = computed(() => {
  const d = slotDates.value[selected.value]
  const s = chartSlots.value[selected.value]
  if (!d || !s || s.future) return null
  const title = span.value === 'year'
    ? cap(d.toLocaleDateString(locale.value, { month: 'long', year: 'numeric' }))
    : dayOffset(d, now.value) === 0
      ? `${m.value.savings.today}, ${shortDate(d)}`
      : cap(d.toLocaleDateString(locale.value, { weekday: 'short', day: 'numeric', month: 'short' }))
  return { ...s, title }
})

// Overview rows
const chargedTotal = computed(() => (data.value ? data.value.totals.chargedSolarKwh + data.value.totals.chargedGridKwh : 0))
const chargedSolarPct = computed(() => (chargedTotal.value > 0 ? Math.round((data.value.totals.chargedSolarKwh / chargedTotal.value) * 100) : 0))
const solarPct = (k: 'selfUsedKwh' | 'exportedKwh' | 'toBatteryKwh') => {
  const t = data.value?.solar?.totals
  return t?.producedKwh > 0 ? Math.round((t[k] / t.producedKwh) * 100) : 0
}
// A source's part of what was saved; a loss counts as nothing
function share(v: number) {
  const pos = Math.max(0, batteryTotal.value) + Math.max(0, solarTotal.value)
  return pos > 0 ? Math.round((Math.max(0, v) / pos) * 100) : 0
}

function open(s: Source) {
  detail.value = s
  window.scrollTo({ top: 0 })
}

function fmtBucket(b: string) {
  const [y, mo, d] = b.split('T')[0]!.split('-').map(Number)
  const date = new Date(y!, mo! - 1, d)
  return bucket.value === 'month' ? cap(monthName(date)) : date.toLocaleDateString(locale.value, { weekday: 'short', day: 'numeric', month: 'short' })
}
</script>

<style scoped>
.page-head.sub { flex-direction: column; align-items: flex-start; gap: 2px; }
.back { display: inline-flex; align-items: center; gap: 2px; font-size: 14px; font-weight: 500; text-decoration: none; color: var(--text-2); margin-left: -6px; }
.back svg { width: 18px; height: 18px; }
.flip { transform: scaleX(-1); }

.period { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 12px; }
.stepper { display: flex; align-items: center; gap: 2px; margin-left: -8px; }
.step { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; }
.step svg { width: 20px; height: 20px; }
.p-name { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 9ch; text-align: center; }
.p-name small { font-size: 14px; font-weight: 400; color: var(--text-2); }

.nothing { margin: 28px 0 36px; }
.nothing h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.nothing p { margin: 0; color: var(--text-2); max-width: 46ch; }

.total { margin: 24px 0 24px; }
.t-value { margin: 0; font-size: clamp(56px, 17vw, 80px); line-height: 0.95; font-weight: 650; font-stretch: 75%; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.t-value.neg { color: var(--alert); }
.t-line { margin: 6px 0 0; font-size: 18px; color: var(--text-2); }
.t-delta { margin: 10px 0 0; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.t-delta.muted { font-weight: 500; }
.t-proj { margin: 2px 0 0; font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }

.chart-block { margin-bottom: 32px; }
.readout { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-height: 22px; margin: 0 0 8px; font-size: 15px; font-variant-numeric: tabular-nums; }
.readout .muted { font-size: 14px; }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 8px 0 0; padding: 0; font-size: 13px; color: var(--text-2); }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.avg-sw { width: 14px; border-top: 1px dashed var(--text-2); }

.src {
  display: grid; grid-template-columns: 8px minmax(0, 1fr) auto 18px; column-gap: 12px; align-items: center;
  width: 100%; padding: 14px 0; border: 0; border-top: 1px solid var(--rule); border-radius: 0; background: none; text-align: left; font-weight: 400;
}
.where { margin-bottom: 4px; }
.src:hover { background: var(--fill-2); }
.src:active { transform: none; }
.src .dot { align-self: start; margin-top: 7px; }
.s-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.s-name { font-size: 16px; font-weight: 600; }
.s-sum { font-size: 13px; color: var(--text-2); }
.share { display: block; height: 4px; margin-top: 5px; border-radius: 2px; background: var(--fill); overflow: hidden; }
.share i { display: block; height: 100%; border-radius: 2px; transition: width 0.6s var(--ease-out); }
.s-value { align-self: start; font-size: 21px; font-weight: 600; font-stretch: 75%; }
.src .chev { width: 18px; height: 18px; color: var(--muted); }

.split { display: flex; gap: 3px; height: 16px; }
.seg { flex-basis: 0; border-radius: 2px; transition: flex-grow 0.9s var(--ease-out); }
.split-legend { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 12px; margin-top: 10px; font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.split-legend span { display: inline-flex; align-items: center; gap: 6px; }
.split-legend b { color: var(--text); font-weight: 600; }

.how > summary { gap: 12px; }
.how-now { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 400; color: var(--text-2); text-align: right; }
.how .list { margin-top: 4px; }
.how select { width: auto; max-width: 55%; }
.how .hint { margin: 4px 2px 0; font-size: 13px; }

/* Large screens: the answer beside the chart, the detail figures next to the split they explain */
@media (min-width: 1024px) {
  .t-value { font-size: 104px; }
  .chart { height: 300px; }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 56px; align-items: start; }
  .pair > * { margin-bottom: 44px; }
  .sources { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 40px; }
}
</style>
