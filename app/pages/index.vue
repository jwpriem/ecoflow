<template>
  <div class="home">
    <header class="top">
      <img class="logo" :src="`/brand/wattwise-logo-${sky === 'night' ? 'dark' : 'light'}.svg`" alt="WattWise" />
      <span v-if="d" class="clock"><span class="dot live" /> {{ time(d.now) }}</span>
    </header>
    <!-- A failed refresh keeps the last data on screen and says how old it is -->
    <p v-if="error && d" class="note stale">{{ m.home.stale(time(d.now)) }}</p>
    <LoadError v-else-if="error" :error="error" :what="m.load.what.batteries" :busy="loading" auto @retry="load" />

    <template v-if="d">
      <!-- No batteries yet: say what to do instead of showing a 0% pack -->
      <section v-if="!d.devices.length" class="status">
        <h1 class="headline">{{ m.home.connectTitle }}</h1>
        <p class="detail">{{ m.home.connectText }}</p>
        <NuxtLink to="/settings" class="go">{{ m.common.openSettings }}</NuxtLink>
      </section>

      <!-- What the batteries are doing, in words -->
      <section v-else class="status" aria-live="polite">
        <h1 class="headline" :class="state">{{ headline }}</h1>
        <p class="detail">{{ detail }}</p>
        <p v-if="d.site.override" class="note">{{ m.home.override(m.mode[d.site.override.mode]?.toLowerCase() ?? d.site.override.mode, time(d.site.override.until)) }}</p>
        <p v-if="d.site.controlMode === 'manual'" class="note">{{ m.home.monitorOnly }}</p>
      </section>

      <!-- The battery as one bar, split into the real units -->
      <section v-if="d.devices.length" class="pack" :aria-label="m.home.batteriesPct(Math.round(combinedSoc * 100))">
        <div class="pack-figure">
          <span class="pct">{{ Math.round(socT * 100) }}<small>%</small></span>
          <span class="kwh">{{ m.home.kwhOf(num(storedKwhT), num(capacityKwh)) }}</span>
        </div>
        <div class="cells">
          <div v-for="b in d.devices" :key="b.id" class="cell" :style="{ flexGrow: b.capacityWh }">
            <div class="cell-body">
              <div class="cell-fill" :class="unitState(b)" :style="{ width: `${(b.soc ?? 0) * 100}%` }" />
              <div v-if="soc?.reserveSoc" class="cell-reserve" :style="{ left: `${soc.reserveSoc * 100}%` }" />
            </div>
            <div class="cell-meta">
              <span class="cell-name">{{ b.name }}</span>
              <span class="cell-pct">{{ b.soc == null ? '–' : `${Math.round(b.soc * 100)}%` }}</span>
              <span class="cell-power" :class="unitState(b)">
                <template v-if="unitState(b) === 'charging'">+{{ watt(b.powerW) }}</template>
                <template v-else-if="unitState(b) === 'discharging'">−{{ watt(-b.powerW) }}</template>
                <template v-else>{{ m.home.idle }}</template>
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- The day: prices, the plan and the charge level on one time axis -->
      <section class="block">
        <div class="block-head">
          <h2>{{ m.home.pricesAndPlan }}</h2>
          <NuxtLink to="/plan">{{ m.home.openPlan }}</NuxtLink>
        </div>
        <DayStrip
          v-if="soc && plan?.slots.length"
          :slots="plan.slots" :history="soc.history" :forecast="soc.forecast" :now="soc.now" :soc-now="soc.socNow" :reserve="soc.reserveSoc"
        />
        <p v-else-if="plan" class="empty-text">{{ m.home.noPrices }}</p>
        <div v-else class="skeleton" style="height: 230px" />
      </section>

      <section v-if="d.devices.length" class="figures">
        <div>
          <span class="f-label">{{ m.home.savedToday }}</span>
          <span class="f-value" :class="{ neg: savedToday < 0 }">{{ eur(savedTodayT) }}</span>
          <span class="f-note">{{ m.home.split(eur(batteryToday), eur(solarToday)) }}</span>
        </div>
        <div>
          <span class="f-label">{{ m.home.priceNow }}</span>
          <template v-if="d.price">
            <span class="f-value">{{ cents(priceT) }}<small> {{ m.common.perKwh }}</small></span>
            <span class="f-note">{{ m.home.feedInNow(cents(d.price.feedIn)) }}</span>
          </template>
          <span v-else class="f-note">{{ m.home.noPriceNow }}</span>
        </div>
      </section>

      <section v-if="d.devices.length || d.live" class="block">
        <div class="block-head">
          <h2>{{ m.home.energyFlow }}</h2>
          <Segmented v-model="view" :options="viewOptions" />
        </div>
        <Transition name="swap" mode="out-in">
          <EnergyFlow v-if="view === 'clean'" key="clean" :solar-w="d.live?.solarW ?? null" :grid-w="d.live?.gridW ?? null" :battery-w="totalPower" :house-w="houseW" :animate="animate" />
          <EnergyScene v-else key="detailed" :solar-w="d.live?.solarW ?? null" :grid-w="d.live?.gridW ?? null" :battery-w="totalPower" :house-w="houseW" :soc="combinedSoc" :animate="animate" />
        </Transition>
      </section>

      <section v-if="nextRuns.length" class="block">
        <div class="block-head"><h2>{{ m.home.upNext }}</h2></div>
        <ol class="next">
          <li v-for="p in nextRuns" :key="String(p.slotStart)">
            <i :style="{ background: ACTION_COLOR[p.action] }" />
            <span class="n-time">{{ time(p.slotStart) }}–{{ time(p.end) }}</span>
            <span class="n-act">{{ m.mode[p.action] }}</span>
            <span class="n-price">{{ cents(p.price) }}</span>
          </li>
        </ol>
      </section>

      <footer class="sources">
        <span><span class="dot" :class="d.sources.pulse.connected ? 'ok' : ''" /> Tibber Pulse</span>
        <span v-for="i in d.sources.integrations" :key="i.provider">
          <span class="dot" :class="i.status === 'ok' ? 'ok' : i.status === 'error' ? 'err' : ''" /> {{ PROVIDER[i.provider] ?? i.provider }}
        </span>
      </footer>
    </template>
    <template v-else-if="!error">
      <div class="skeleton" style="height: 120px; margin-bottom: 24px" />
      <div class="skeleton" style="height: 260px" />
    </template>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const d = ref<any>(null)
const soc = ref<any>(null)
const plan = ref<any>(null)
const error = ref<any>(null)
const loading = ref(false)
const sky = useState<'day' | 'night'>('sky', () => 'day')
const { view, animate } = useFlowView()
const { m } = useLocale()
const viewOptions = computed(() => [
  { value: 'clean' as const, label: m.value.home.viewClean },
  { value: 'detailed' as const, label: m.value.home.viewHouse },
])
const PROVIDER: Record<string, string> = { tibber: 'Tibber', solaredge: 'SolarEdge', ecoflow_official: 'EcoFlow' }
const ACTION_COLOR: Record<string, string> = {
  charge_grid: 'var(--cheap)',
  discharge: 'var(--dear)',
  self_use: 'var(--own)',
  solar_only: 'var(--hold)',
}
const cents = (p: number) => `${num(p * 100, 1)} ct`

async function load() {
  loading.value = true
  try {
    const [dash, s, p] = await Promise.all([api('/api/dashboard'), api('/api/soc').catch(() => null), api('/api/plan').catch(() => null)])
    d.value = dash
    if (s) soc.value = s
    if (p) plan.value = p
    error.value = null
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

const capacityKwh = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + b.capacityWh, 0) / 1000)
const storedKwh = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + (b.soc ?? 0) * b.capacityWh, 0) / 1000)
const storedKwhT = useTweened(() => storedKwh.value, { stiffness: 40 })
const combinedSoc = computed(() => (capacityKwh.value ? storedKwh.value / capacityKwh.value : 0))
const socT = useTweened(() => combinedSoc.value, { stiffness: 40 })
const unitState = (b: any) => (b.powerW > 5 ? 'charging' : b.powerW < -5 ? 'discharging' : 'idle')
const totalPower = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + b.powerW, 0))
const houseW = computed(() => (d.value?.live?.houseNetW != null ? d.value.live.houseNetW + (d.value.live.solarW ?? 0) : null))
const state = computed(() => (totalPower.value > 5 ? 'charging' : totalPower.value < -5 ? 'discharging' : 'idle'))
const batteryToday = computed(() => d.value?.today?.savingNaive ?? 0)
// Solar stored in the batteries is counted once, in the battery saving (stored solar counts as free there)
const { solarValue } = useSolarCount()
const solarToday = computed(() => solarValue(d.value?.solarToday))
const savedToday = computed(() => batteryToday.value + solarToday.value)
const savedTodayT = useTweened(() => savedToday.value)
const priceT = useTweened(() => d.value?.price?.total ?? 0)

// Merge consecutive slots with the same action into runs: "14:00–15:30 Discharge"
const nextRuns = computed(() => {
  const out: { slotStart: string; end: string; action: string; price: number }[] = []
  for (const p of d.value?.next ?? []) {
    const last = out[out.length - 1]
    const end = new Date(new Date(p.slotStart).getTime() + 15 * 60_000).toISOString()
    if (last && last.action === p.action) last.end = end
    else out.push({ slotStart: p.slotStart, end, action: p.action, price: p.price })
  }
  return out.slice(0, 5)
})
const currentRun = computed(() => nextRuns.value[0] ?? null)

const headline = computed(() => {
  const solar = d.value?.live?.solarW ?? 0
  const grid = d.value?.live?.gridW ?? 0
  const action = currentRun.value?.action
  const t = m.value.home
  if (state.value === 'charging') {
    if (action === 'charge_grid' || (grid > 50 && solar < totalPower.value)) return t.chargingGrid
    return solar > 5 ? t.chargingSun : t.charging
  }
  if (state.value === 'discharging') return grid < -50 ? t.feedingGrid : t.runningHouse
  if (combinedSoc.value >= (soc.value?.maxSoc ?? 1) - 0.01) return t.full
  if (soc.value?.reserveSoc && combinedSoc.value <= soc.value.reserveSoc + 0.01) return t.atReserve
  if (action === 'solar_only') return t.holding
  return t.idleHeadline
})
const detail = computed(() => {
  const parts: string[] = []
  const run = currentRun.value
  const t = m.value.home
  if (state.value !== 'idle') parts.push(t.powerUntil(watt(Math.abs(totalPower.value)), run ? time(run.end) : null))
  else if (run) parts.push(t.nextChange(time(run.end)))
  if (d.value?.price) parts.push(t.costsNow(cents(d.value.price.total)))
  return parts.join(' ')
})

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.logo { height: 26px; width: auto; display: block; }
.clock { font-size: 14px; color: var(--text-2); display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }

/* The status sentence: Archivo at full width is the page's voice */
.status { margin-bottom: 28px; }
.headline {
  font-size: clamp(30px, 8.4vw, 48px); line-height: 1.02; font-weight: 750; font-stretch: 125%;
  letter-spacing: -0.025em; margin: 0 0 12px; max-width: 14ch; text-wrap: balance;
}
.detail { font-size: 18px; line-height: 1.4; color: var(--text-2); margin: 0; max-width: 34ch; font-variant-numeric: tabular-nums; }

/* Empty and stale states */
.go { display: inline-block; margin-top: 16px; font-weight: 600; }
.stale { margin: -16px 0 24px; }
.empty-text { margin: 0; color: var(--text-2); max-width: 46ch; }

/* Battery pack */
.pack { margin-bottom: 40px; }
.pack-figure { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.pct { font-size: 48px; line-height: 1; font-weight: 650; font-stretch: 75%; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.pct small { font-size: 24px; font-weight: 500; color: var(--text-2); margin-left: 1px; }
.kwh { font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; font-stretch: 88%; }
.cells { display: flex; gap: 14px; }
.cell { flex: 1 1 0; min-width: 0; }
.cell-body { position: relative; height: 40px; border: 1.5px solid var(--text); border-radius: 6px; padding: 3px; }
.cell-fill { height: 100%; background: var(--text); border-radius: 2px; transition: width 1s var(--ease-out); position: relative; }
/* The leading edge shows which way the energy goes */
.cell-fill.charging { box-shadow: inset -4px 0 0 var(--cheap); }
.cell-fill.discharging { box-shadow: inset -4px 0 0 var(--dear); }
.cell-reserve { position: absolute; bottom: -8px; width: 1.5px; height: 5px; margin-left: 2px; background: var(--text-2); }
.cell-meta { display: flex; gap: 8px; align-items: baseline; margin-top: 10px; font-size: 14px; font-variant-numeric: tabular-nums; font-stretch: 88%; white-space: nowrap; }
.cell-name { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cell-pct { font-weight: 600; }
.cell-power { margin-left: auto; color: var(--text-2); }
.cell-power.charging { color: var(--cheap); }
.cell-power.discharging { color: var(--dear); }



.block :deep(.flow) { max-width: 420px; margin: 0 auto; }
.swap-enter-active, .swap-leave-active { transition: opacity 0.2s; }
.swap-enter-from, .swap-leave-to { opacity: 0; }

.next { list-style: none; margin: 0; padding: 0; }
.next li { display: grid; grid-template-columns: 10px 104px 1fr auto; align-items: baseline; gap: 12px; padding: 10px 0; font-size: 16px; }
.next li + li { border-top: 1px solid var(--rule); }
.next i { width: 10px; height: 10px; border-radius: 2px; align-self: center; }
.n-time, .n-price { font-variant-numeric: tabular-nums; font-stretch: 85%; }
.n-time { color: var(--text-2); }
.n-price { font-size: 14px; color: var(--text-2); }

.sources { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--text-2); }
.sources > span { display: inline-flex; align-items: center; gap: 6px; }

@media (min-width: 720px) {
  .top { margin-bottom: 48px; }
  .status { margin-bottom: 36px; }
}
</style>
