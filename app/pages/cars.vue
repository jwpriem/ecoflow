<template>
  <div>
    <header class="page-head"><h1>{{ m.cars.title }}</h1></header>
    <LoadError v-if="loadError" :error="loadError" :what="m.cars.what" :busy="busy === 'load'" @retry="retryLoad" />

    <template v-else-if="cars !== null">
      <!-- Nothing connected yet -->
      <section v-if="!cars.length" class="nothing">
        <h2>{{ m.cars.connectTitle }}</h2>
        <p>{{ m.cars.connectText }}</p>
        <NuxtLink to="/settings" class="go">{{ m.common.openSettings }}</NuxtLink>
      </section>

      <template v-for="c in cars" :key="c.id">
        <section class="car">
          <header class="car-head">
            <h2 class="car-name">{{ c.name }}</h2>
            <span class="where" :class="{ home: c.state.atHome }">
              <AppIcon :name="c.state.atHome ? 'house' : 'car'" />
              {{ c.state.atHome ? m.cars.atHome : m.cars.away }}
            </span>
            <span v-if="c.model" class="sub">{{ c.model }}</span>
          </header>

          <CarFigure
            :soc="c.state.soc" :charging="c.state.charging" :target="c.state.targetSoc" :model="c.model" :name="c.name"
            :label="m.cars.figureAria(c.name, c.state.soc == null ? m.cars.levelUnknown : m.cars.pctCharged(Math.round(c.state.soc * 100)), carStatus(c).text)"
          />

          <div class="readout">
            <div>
              <span class="pct">{{ c.state.soc == null ? '–' : Math.round(c.state.soc * 100) }}<small>%</small></span>
              <p class="status-line" :class="carStatus(c).cls">{{ carStatus(c).text }}</p>
            </div>
            <div v-if="c.state.rangeKm != null" class="range">
              <span class="km">{{ Math.round(c.state.rangeKm) }}<small> km</small></span>
              <p v-if="fullRange(c)" class="status-line muted">{{ m.cars.fullRange(fullRange(c)!) }}</p>
            </div>
          </div>

          <dl class="facts">
            <div><dt>{{ m.cars.plug }}</dt><dd>{{ c.state.pluggedIn ? m.cars.pluggedIn : m.cars.unplugged }}</dd></div>
            <div v-if="c.state.chargePowerW"><dt>{{ m.cars.power }}</dt><dd class="live">{{ watt(c.state.chargePowerW) }}</dd></div>
            <div v-if="c.state.targetSoc != null"><dt>{{ m.cars.target }}</dt><dd>{{ Math.round(c.state.targetSoc * 100) }}%</dd></div>
            <div v-if="c.state.ts"><dt>{{ m.cars.updated }}</dt><dd>{{ time(c.state.ts) }}</dd></div>
            <div v-if="c.state.tibberSyncedAt"><dt>{{ m.cars.tibberSynced }}</dt><dd>{{ time(c.state.tibberSyncedAt) }}</dd></div>
          </dl>

          <details class="edit">
            <summary>{{ m.cars.edit }}</summary>
            <div class="list">
              <label class="list-row"><span class="title">{{ m.cars.name }}</span><input v-model="c.name" /></label>
              <label class="list-row">
                <span class="title">{{ m.cars.capacity }}</span>
                <span class="unit-in"><input v-model.number="c.capacityKwh" type="number" step="0.5" inputmode="decimal" /> kWh</span>
              </label>
              <label v-if="tibberCars.length" class="list-row">
                <span class="title">{{ m.cars.tibberCar }}</span>
                <select v-model="c.tibberVehicleId">
                  <option :value="null">{{ m.cars.tibberNone }}</option>
                  <option v-for="t in tibberCars" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
              </label>
              <div class="list-row"><button class="plain" @click="saveCar(c)">{{ m.cars.save }}</button><span v-if="savedId === c.id" class="small pos">{{ m.cars.saved }}</span></div>
            </div>
          </details>
        </section>
      </template>

      <p v-if="cars.length" class="foot">{{ m.cars.foot }}</p>
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
const savedId = ref<number | null>(null)
const loadError = ref<any>(null)
// The cars known in the Tibber app, when it is connected: pick which one each car is
const tibberCars = ref<{ id: string; name: string }[]>([])

// The range on a full charge, extrapolated from the current one, to the nearest 10 km
function fullRange(c: any) {
  const { rangeKm, soc } = c.state
  if (rangeKm == null || soc == null || soc < 0.05) return null
  return Math.round(rangeKm / soc / 10) * 10
}
async function load() {
  cars.value = await api('/api/vehicles')
}
async function loadTibberCars() {
  const list: any[] = await api('/api/integrations')
  tibberCars.value = (list.find((i) => i.provider === 'tibber_app')?.meta.vehicles as any[]) ?? []
}
async function saveCar(c: any) {
  await api(`/api/vehicles/${c.id}`, { method: 'PUT', body: { name: c.name, capacityKwh: c.capacityKwh ?? null, ...(tibberCars.value.length ? { tibberVehicleId: c.tibberVehicleId ?? null } : {}) } })
  savedId.value = c.id
  setTimeout(() => (savedId.value = null), 2500)
}
async function safeLoad() {
  try {
    await load()
    loadError.value = null
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
onMounted(() => {
  safeLoad()
  loadTibberCars().catch(() => undefined)
  timer = setInterval(safeLoad, 60_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.nothing { border-top: 1px solid var(--rule); padding-top: 18px; margin-bottom: 36px; }
.nothing h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.nothing p { margin: 0 0 14px; color: var(--text-2); max-width: 46ch; }
.go { font-weight: 600; }

/* Each car is a section on the canvas, split by a rule like the blocks on Home */
.car { border-top: 1px solid var(--rule); padding-top: 14px; margin-bottom: 44px; }
.car-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; margin-bottom: 8px; }
.car-name { font-size: 21px; font-weight: 700; font-stretch: 112%; letter-spacing: -0.005em; margin: 0; }
.where { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; font-size: 14px; color: var(--text-2); }
.where svg { width: 16px; height: 16px; }
.where.home { color: var(--text); }
.sub { flex-basis: 100%; font-size: 14px; color: var(--text-2); }

.readout { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: 16px; }
.range { text-align: right; }
.pct, .km { font-size: 48px; line-height: 1; font-weight: 650; font-stretch: 75%; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.pct small { font-size: 24px; font-weight: 500; color: var(--text-2); margin-left: 1px; }
.km small { font-size: 18px; font-weight: 500; color: var(--text-2); }
.status-line { margin: 6px 0 0; font-size: 14px; font-weight: 600; }
.status-line.muted { font-weight: 400; color: var(--text-2); }
.status-line.charging { color: var(--cheap); }

.facts { margin: 22px 0 0; border-top: 1px solid var(--rule); }
.facts > div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--rule); }
.facts dt { color: var(--text-2); }
.facts dd { margin: 0; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.facts dd.live { color: var(--cheap); }

.edit { margin-top: 12px; }
.edit summary { cursor: pointer; font-size: 14px; color: var(--text-2); padding: 6px 0; }
.unit-in { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; color: var(--text-2); width: 55%; }
.unit-in input { width: 100%; }
.foot { font-size: 13px; color: var(--text-2); margin: 4px 2px 0; max-width: 60ch; }
</style>
