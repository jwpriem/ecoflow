<template>
  <div class="home">
    <header class="top">
      <img class="logo" :src="`/brand/wattswise-logo-${sky === 'night' ? 'dark' : 'light'}.svg`" alt="WattsWise" />
      <span v-if="d" class="clock"><span class="dot live" /> {{ time(d.now) }}</span>
    </header>
    <!-- A failed refresh keeps the last data on screen and says how old it is -->
    <p v-if="error && d" class="note stale">{{ m.home.stale(time(d.now)) }}</p>
    <LoadError v-else-if="error" :error="error" :what="m.load.what.batteries" :busy="loading" auto @retry="load" />

    <template v-if="d">
      <!-- One column on a phone; on a large screen the charge and the day on the left, the flow and cars beside them -->
      <div class="cols">
      <div class="main">
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
        <!-- What the stored energy cost to buy, and what it is worth at the current price -->
        <p v-if="stored" class="pack-value">
          {{ m.home.storedCost(eur(stored.cost), cents(stored.cost / stored.kwh)) }}<template v-if="d.price">, {{ m.home.storedWorth(eur(stored.kwh * d.price.total)) }}</template>
        </p>
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
      </div>

      <div class="side">
      <!-- The cars at a glance; the Cars tab has the details -->
      <section v-if="cars.length" class="block">
        <div class="block-head">
          <h2>{{ m.home.cars }}</h2>
          <NuxtLink to="/cars">{{ m.home.openCars }}</NuxtLink>
        </div>
        <NuxtLink v-for="c in cars" :key="c.id" to="/cars" class="car-row">
          <span class="cr-name">{{ c.model || c.name }}</span>
          <span class="cr-pct">{{ c.state.soc == null ? '–' : Math.round(c.state.soc * 100) }}<small>%</small></span>
          <div class="cr-bar"><div class="cr-fill" :class="carStatus(c).cls" :style="{ width: `${(c.state.soc ?? 0) * 100}%` }" /></div>
          <span class="cr-status">
            <span :class="carStatus(c).cls">{{ carStatus(c).text }}</span>
, {{ (c.state.atHome ? m.cars.atHome : m.cars.away).toLowerCase() }}<template v-if="c.state.rangeKm != null">, {{ Math.round(c.state.rangeKm) }} km</template>
          </span>
        </NuxtLink>
      </section>

      <section v-if="d.devices.length || d.live" class="block flow-block">
        <div class="block-head">
          <h2>{{ m.home.energyFlow }}</h2>
          <Segmented v-model="view" :options="viewOptions" />
        </div>
        <Transition name="swap" mode="out-in">
          <EnergyFlow v-if="view === 'clean'" key="clean" :solar-w="d.live?.solarW ?? null" :grid-w="d.live?.gridW ?? null" :battery-w="totalPower" :house-w="houseW" :animate="animate" />
          <EnergyScene v-else key="detailed" :solar-w="d.live?.solarW ?? null" :grid-w="d.live?.gridW ?? null" :battery-w="totalPower" :house-w="sceneHouseW" :soc="combinedSoc" :car="sceneCar" :animate="animate" />
        </Transition>
      </section>

      <footer class="sources">
        <span class="sources-clock"><span class="dot live" /> {{ time(d.now) }}</span>
        <span><span class="dot" :class="d.sources.pulse.connected ? 'ok' : ''" /> Tibber Pulse</span>
        <span v-for="i in d.sources.integrations" :key="i.provider">
          <span class="dot" :class="i.status === 'ok' ? 'ok' : i.status === 'error' ? 'err' : ''" /> {{ PROVIDER[i.provider] ?? i.provider }}
        </span>
      </footer>
      </div>
      </div>
    </template>
    <template v-else-if="!error">
      <div class="skeleton" style="height: 120px; margin-bottom: 24px" />
      <div class="skeleton" style="height: 260px" />
    </template>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
// Shared with the rail, which shows the batteries on the other pages
const d = useState<any>('dashboard', () => null)
const soc = ref<any>(null)
const plan = ref<any>(null)
// Empty when no cars are connected: the block then stays hidden
const cars = ref<any[]>([])
const error = ref<any>(null)
const loading = ref(false)
const sky = useState<'day' | 'night'>('sky', () => 'day')
const { view, animate } = useFlowView()
const { m } = useLocale()
const { carStatus } = useCarStatus()
const { loadMe } = useAuth()
const viewOptions = computed(() => [
  { value: 'clean' as const, label: m.value.home.viewClean },
  { value: 'detailed' as const, label: m.value.home.viewHouse },
])
const PROVIDER: Record<string, string> = { tibber: 'Tibber', solaredge: 'SolarEdge', ecoflow_official: 'EcoFlow', zeekr: 'Zeekr', tibber_app: 'Tibber app' }
const cents = (p: number) => `${num(p * 100, 1)} ct`

async function load() {
  loading.value = true
  try {
    const [dash, s, p, v] = await Promise.all([
      api('/api/dashboard'),
      api('/api/soc').catch(() => null),
      api('/api/plan').catch(() => null),
      // Cars only for a household with the experimental integrations on; for others the server refuses
      loadMe().then((me) => (me?.experimental ? api('/api/vehicles') : null)).catch(() => null),
    ])
    d.value = dash
    if (s) soc.value = s
    if (p) plan.value = p
    if (v) cars.value = v as any[]
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
// Sum of the ledger pools: solar counts as free, like the savings figure
const stored = computed(() => {
  const pools = (d.value?.devices ?? []).map((b: any) => b.stored).filter(Boolean)
  const kwh = pools.reduce((s: number, p: any) => s + p.kwh, 0)
  return pools.length && kwh > 0.01 ? { kwh, cost: pools.reduce((s: number, p: any) => s + p.costNaive, 0) } : null
})
const unitState = (b: any) => (b.powerW > 5 ? 'charging' : b.powerW < -5 ? 'discharging' : 'idle')
const totalPower = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + b.powerW, 0))
const houseW = computed(() => (d.value?.live?.houseNetW != null ? d.value.live.houseNetW + (d.value.live.solarW ?? 0) : null))
// The car drawn beside the house: one that's charging first, then one plugged in, then any at home.
// A reading older than half an hour (the poll runs every 5 minutes) no longer says where the car is.
const sceneCar = computed(() => {
  const now = Date.now()
  const rank = (c: any) => (c.state.charging ? 0 : c.state.pluggedIn ? 1 : 2)
  const c = cars.value
    .filter((c) => c.state.atHome && c.state.ts && now - Date.parse(c.state.ts) < 30 * 60_000)
    .sort((a, b) => rank(a) - rank(b))[0]
  if (!c) return null
  const charging = !!c.state.charging
  return { name: c.name, soc: c.state.soc ?? null, plugged: !!c.state.pluggedIn, charging, powerW: charging ? (c.state.chargePowerW ?? null) : null }
})
// The scene draws the charging car on its own, so the house there shows what's left without it
const sceneHouseW = computed(() => {
  const car = sceneCar.value
  if (houseW.value == null || !car?.charging || !car.powerW) return houseW.value
  return Math.max(0, houseW.value - car.powerW)
})
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
  const next = nextRuns.value[1]
  const w = watt(Math.abs(totalPower.value))
  // The plan's next step lives in this sentence now that Home has no Up next list; the full list is on Plan
  if (state.value !== 'idle') {
    parts.push(next ? t.powerUntilThen(w, run ? time(run.end) : null, (m.value.mode[next.action] ?? next.action).toLowerCase()) : t.powerUntil(w, run ? time(run.end) : null))
  } else if (next) parts.push(t.nextFrom(m.value.mode[next.action] ?? next.action, time(next.slotStart)))
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
.pack-value { margin: 14px 0 0; font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }



.block :deep(.flow) { max-width: 420px; margin: 0 auto; }
.swap-enter-active, .swap-leave-active { transition: opacity 0.2s; }
.swap-enter-from, .swap-leave-to { opacity: 0; }

/* Cars: one compact row each, the whole row opens the Cars tab */
.car-row { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 6px 12px; padding: 10px 0; color: inherit; text-decoration: none; }
.car-row + .car-row { border-top: 1px solid var(--rule); }
.cr-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-pct { font-size: 24px; line-height: 1; font-weight: 600; font-stretch: 75%; font-variant-numeric: tabular-nums; }
.cr-pct small { font-size: 14px; font-weight: 400; color: var(--text-2); }
.cr-bar { grid-column: 1 / -1; height: 6px; border-radius: 3px; background: var(--fill); overflow: hidden; }
.cr-fill { height: 100%; border-radius: 3px; background: var(--text-2); transition: width 1s var(--ease-out); }
.cr-fill.charging { background: var(--cheap); }
.cr-status { grid-column: 1 / -1; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.cr-status .charging { color: var(--cheap); font-weight: 600; }
.cr-status .plugged { color: var(--text); }

.sources { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--text-2); }
.sources > span { display: inline-flex; align-items: center; gap: 6px; }
.sources > .sources-clock { display: none; }

@media (min-width: 720px) {
  .top { margin-bottom: 48px; }
  .status { margin-bottom: 36px; }
}
@media (hover: hover) {
  .car-row:hover .cr-name { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--muted); }
}
/* The rail carries the logo; the flow sits beside the headline, where the eye lands first */
@media (min-width: 1024px) {
  .top { display: none; }
  .sources > .sources-clock { display: inline-flex; color: var(--text); font-variant-numeric: tabular-nums; }
  .headline { font-size: 60px; max-width: 13ch; }
  .detail { font-size: 19px; max-width: 40ch; }
  .status { margin: 24px 0 44px; }
  .side { display: flex; flex-direction: column; padding-top: 10px; }
  .flow-block { order: -1; }
  .block :deep(.flow) { max-width: none; }
}
</style>
