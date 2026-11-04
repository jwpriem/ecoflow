<template>
  <div>
    <header class="page-head">
      <h1>{{ m.cars.title }}</h1>
      <!-- Name, capacity and the Tibber car are set in Settings -->
      <NuxtLink v-if="cars?.length" to="/settings#cars" class="to-settings">{{ m.cars.editInSettings }}<AppIcon name="chevron" /></NuxtLink>
    </header>
    <LoadError v-if="loadError" :error="loadError" :what="m.cars.what" :busy="busy === 'load'" @retry="retryLoad" />

    <template v-else-if="cars !== null">
      <!-- Nothing connected yet -->
      <section v-if="!cars.length" class="nothing">
        <h2>{{ m.cars.connectTitle }}</h2>
        <p>{{ m.cars.connectText }}</p>
        <NuxtLink to="/settings" class="go">{{ m.common.openSettings }}</NuxtLink>
      </section>

      <!-- With more than one car, one sentence says where they all are first -->
      <p v-if="cars.length > 1" class="summary">
        <template v-for="c in cars" :key="c.id">
          {{ c.name }} <span :class="summary(c).cls">{{ summary(c).verb }}</span><template v-if="summary(c).where"> <span class="quiet">{{ summary(c).where }}</span></template>.
        </template>
      </p>

      <div class="cars">
        <section v-for="c in cars" :key="c.id" class="car">
          <header class="car-head">
            <div>
              <h2 class="car-name">{{ c.name }}</h2>
              <span class="where" :class="{ home: c.state.atHome }">
                <AppIcon :name="c.state.atHome ? 'house' : 'car'" />
                {{ c.state.atHome ? m.cars.atHome : m.cars.away }}
              </span>
            </div>
            <div class="level">
              <span class="pct">{{ c.state.soc == null ? '–' : Math.round(c.state.soc * 100) }}<small>%</small></span>
              <p class="status-line" :class="carStatus(c).cls">{{ carStatus(c).text }}</p>
            </div>
          </header>

          <CarFigure
            :soc="c.state.soc" :charging="c.state.charging" :target="c.state.targetSoc" :model="c.model" :name="c.name"
            :label="m.cars.figureAria(c.name, c.state.soc == null ? m.cars.levelUnknown : m.cars.pctCharged(Math.round(c.state.soc * 100)), carStatus(c).text)"
          />

          <!-- Only what matters now: plug and charge power are in the status line, the times in the note below -->
          <div v-if="c.state.rangeKm != null || c.state.targetSoc != null || c.tibberVehicleId" class="list">
            <div v-if="c.state.rangeKm != null" class="list-row">
              <span class="title">{{ m.cars.rangeLabel }}</span>
              <span class="detail">
                {{ Math.round(c.state.rangeKm) }} km
                <span v-if="fullRange(c)" class="full">{{ m.cars.fullRange(fullRange(c)!) }}</span>
              </span>
            </div>
            <div v-if="c.state.targetSoc != null" class="list-row">
              <span class="title">{{ m.cars.target }}</span>
              <span class="detail">{{ Math.round(c.state.targetSoc * 100) }}%</span>
            </div>
            <button v-if="c.tibberVehicleId" type="button" class="list-row" @click="asking = c">
              <span class="title">{{ m.cars.departure.row }}</span>
              <span class="detail row-end">{{ c.departure ? departureText(c.departure) : m.cars.departure.unset }}<AppIcon name="chevron" class="chev" /></span>
            </button>
          </div>
          <ChargePlan v-if="showPlan(c)" :plan="plans[c.id] ?? null" :error="planErrors[c.id]" />
          <p v-if="c.state.ts" class="stamps">{{ m.cars.stamps(time(c.state.ts), c.state.tibberSyncedAt ? time(c.state.tibberSyncedAt) : null) }}</p>
        </section>
      </div>

      <p v-if="cars.length" class="foot">{{ m.cars.foot }}</p>
      <DepartureSheet :car="asking" @close="closeSheet" @saved="afterDeparture" />
    </template>

    <template v-else>
      <div class="skeleton" style="height: 180px; margin-bottom: 16px" />
      <div class="skeleton" style="height: 180px" />
    </template>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const { m } = useLocale()
const { carStatus } = useCarStatus()
const cars = ref<any[] | null>(null)
const busy = ref('')
const loadError = ref<any>(null)
// The car whose departure is being asked; ?departure=<id> (from the plug-in notification) opens it
const route = useRoute()
const router = useRouter()
const asking = ref<any | null>(null)

const DAY_INDEX: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
function departureText(d: { day: string; time: string }) {
  // Any date on that weekday gives its name
  const date = new Date(2024, 0, 7 + DAY_INDEX[d.day]!)
  return `${date.toLocaleDateString(m.value.dateLocale, { weekday: 'long' })} ${d.time}`
}
function openFromRoute() {
  const id = Number(route.query.departure)
  if (!id || !cars.value) return
  asking.value = cars.value.find((c) => c.id === id) ?? null
}
function closeSheet() {
  asking.value = null
  if (route.query.departure) router.replace({ query: { ...route.query, departure: undefined } })
}
watch(() => route.query.departure, openFromRoute)

// One car's part of the summary sentence: what it does, and where. A parked car away is just away
function summary(c: any): { verb: string; where: string; cls: string } {
  const t = m.value.cars.summary
  const s = c.state ?? {}
  const where = s.atHome ? t.home : t.away
  if (s.soc == null) return { verb: t.asleep, where, cls: 'quiet' }
  if (s.charging) return { verb: t.charging, where, cls: 'charging' }
  if (s.pluggedIn) return { verb: t.plugged, where, cls: 'quiet' }
  return s.atHome ? { verb: t.idle, where, cls: 'quiet' } : { verb: t.gone, where: '', cls: 'quiet' }
}

// The range on a full charge, extrapolated from the current one, to the nearest 10 km
function fullRange(c: any) {
  const { rangeKm, soc } = c.state
  if (rangeKm == null || soc == null || soc < 0.05) return null
  return Math.round(rangeKm / soc / 10) * 10
}
async function load() {
  cars.value = await api('/api/vehicles')
}

// Tibber's charging plan per car (only for cars linked to a car in Tibber)
const plans = ref<Record<number, any>>({})
const planErrors = ref<Record<number, boolean>>({})
function showPlan(c: any) {
  if (!c.tibberVehicleId) return false
  return !!plans.value[c.id]?.windows.length || (c.state.pluggedIn && c.state.atHome) || planErrors.value[c.id]
}
async function loadPlans() {
  for (const c of cars.value ?? []) {
    if (!c.tibberVehicleId) continue
    try {
      const { plan } = await api<{ plan: any }>(`/api/vehicles/${c.id}/plan`)
      plans.value = { ...plans.value, [c.id]: plan }
      planErrors.value = { ...planErrors.value, [c.id]: false }
    } catch {
      planErrors.value = { ...planErrors.value, [c.id]: true }
    }
  }
}
async function afterDeparture() {
  await safeLoad()
  // Tibber replans after a new departure time: look again shortly
  setTimeout(() => loadPlans(), 20_000)
}
async function safeLoad() {
  try {
    await load()
    loadError.value = null
    if (!asking.value) openFromRoute()
  } catch (e) {
    loadError.value = e
  }
}
async function retryLoad() {
  busy.value = 'load'
  await safeLoad()
  busy.value = ''
}

let timer: ReturnType<typeof setInterval>
let planTimer: ReturnType<typeof setInterval>
onMounted(async () => {
  timer = setInterval(safeLoad, 60_000)
  planTimer = setInterval(loadPlans, 5 * 60_000)
  await safeLoad()
  loadPlans()
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(planTimer)
})
</script>

<style scoped>
.to-settings { display: inline-flex; align-items: center; gap: 2px; font-size: 14px; color: var(--text-2); text-decoration: none; }
.to-settings svg { width: 14px; height: 14px; }
.nothing { border-top: 1px solid var(--rule); padding-top: 18px; margin-bottom: 36px; }
.nothing h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.nothing p { margin: 0 0 14px; color: var(--text-2); max-width: 46ch; }
.go { font-weight: 600; }

/* The status sentence, set wide like the one on Home: names in ink, what they do quieter, charging in its color */
.summary { font-size: 21px; line-height: 1.3; font-weight: 600; font-stretch: 112%; letter-spacing: -0.005em; margin: 0 0 32px; max-width: 34ch; }
.summary .quiet { color: var(--text-2); }
.summary .charging { color: var(--cheap); }

/* Each car is a section on the canvas, split by a rule like the blocks on Home */
.car { border-top: 1px solid var(--rule); padding-top: 14px; margin-bottom: 36px; }
.car-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.car-name { font-size: 21px; font-weight: 700; font-stretch: 112%; letter-spacing: -0.005em; margin: 0; }
.where { display: inline-flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 14px; color: var(--text-2); }
.where svg { width: 16px; height: 16px; }
.where.home { color: var(--text); }
.level { text-align: right; }
.pct { font-size: 36px; line-height: 1; font-weight: 650; font-stretch: 75%; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.pct small { font-size: 18px; font-weight: 500; color: var(--text-2); margin-left: 1px; }
.status-line { margin: 4px 0 0; font-size: 14px; font-weight: 600; color: var(--text-2); }
.status-line.charging { color: var(--cheap); }

.list { margin-bottom: 0; }
.detail .full { display: block; font-size: 13px; }
button.list-row { color: var(--text); }
.row-end { display: inline-flex; align-items: center; gap: 4px; }
.chev { width: 16px; height: 16px; color: var(--muted); }
.stamps { font-size: 13px; color: var(--text-2); margin: 8px 16px 0; font-variant-numeric: tabular-nums; }
.foot { font-size: 13px; color: var(--text-2); margin: 4px 2px 0; max-width: 60ch; }

/* Large screens: cars side by side */
@media (min-width: 1024px) {
  .cars { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 0 56px; }
}
</style>
