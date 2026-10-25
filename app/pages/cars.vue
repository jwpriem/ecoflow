<template>
  <div>
    <header class="page-head"><h1>{{ m.cars.title }}</h1></header>
    <LoadError v-if="loadError" :error="loadError" :what="m.cars.what" :busy="busy === 'load'" @retry="retryLoad" />

    <template v-else-if="cars !== null">
      <!-- Nothing connected yet -->
      <section v-if="!cars.length" class="status">
        <h2 class="headline">{{ m.cars.connectTitle }}</h2>
        <p class="detail">{{ m.cars.connectText }}</p>
        <NuxtLink to="/settings" class="go">{{ m.common.openSettings }}</NuxtLink>
      </section>

      <template v-for="c in cars" :key="c.id">
        <section class="car">
          <div class="car-head">
            <div class="stack-text">
              <h2 class="car-name">{{ c.name }}</h2>
              <span v-if="c.model" class="small muted">{{ c.model }}</span>
            </div>
            <span class="chip" :class="homeClass(c)">
              <AppIcon :name="c.state.atHome ? 'house' : 'car'" />
              {{ c.state.atHome ? m.cars.atHome : m.cars.away }}
            </span>
          </div>

          <div class="car-figure">
            <span class="pct" :class="{ charging: c.state.charging }">
              {{ c.state.soc == null ? '–' : Math.round(c.state.soc * 100) }}<small>%</small>
            </span>
            <div class="car-meta">
              <span class="status-line" :class="statusClass(c)">{{ statusText(c) }}</span>
              <span v-if="c.state.rangeKm != null" class="small muted">{{ m.cars.range(Math.round(c.state.rangeKm)) }}</span>
            </div>
          </div>

          <div class="bar"><div class="bar-fill" :class="{ charging: c.state.charging }" :style="{ width: `${(c.state.soc ?? 0) * 100}%` }" /></div>

          <dl class="facts">
            <div><dt>{{ m.cars.plug }}</dt><dd>{{ c.state.pluggedIn ? m.cars.pluggedIn : m.cars.unplugged }}</dd></div>
            <div v-if="c.state.chargePowerW"><dt>{{ m.cars.power }}</dt><dd>{{ watt(c.state.chargePowerW) }}</dd></div>
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
const cars = ref<any[] | null>(null)
const busy = ref('')
const savedId = ref<number | null>(null)
const loadError = ref<any>(null)
// The cars known in the Tibber app, when it is connected: pick which one each car is
const tibberCars = ref<{ id: string; name: string }[]>([])

function homeClass(c: any) {
  return c.state.atHome ? 'home' : ''
}
function statusClass(c: any) {
  return c.state.charging ? 'charging' : c.state.pluggedIn ? 'plugged' : ''
}
function statusText(c: any): string {
  if (c.state.soc == null) return m.value.cars.asleep
  if (c.state.charging) return c.state.chargePowerW ? m.value.cars.chargingAt(watt(c.state.chargePowerW)) : m.value.cars.charging
  if (c.state.pluggedIn) return m.value.cars.plugged
  return m.value.cars.idle
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
.page-head { margin-bottom: 8px; }
.status { text-align: center; padding: 40px 16px; }
.headline { font-size: 22px; margin: 0 0 8px; }
.detail { color: var(--text-2); margin: 0 0 20px; max-width: 42ch; margin-inline: auto; }
.go { display: inline-block; padding: 10px 18px; border-radius: 999px; background: var(--text); color: var(--surface); font-weight: 600; }
.car { background: var(--surface-2, var(--surface)); border-radius: 18px; padding: 18px; margin-bottom: 16px; }
.car-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.car-name { font-size: 18px; margin: 0; }
.stack-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--text-2); background: var(--fill-2, var(--fill)); padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.chip svg { width: 15px; height: 15px; }
.chip.home { color: var(--text); }
.car-figure { display: flex; align-items: baseline; gap: 16px; margin: 14px 0 10px; }
.pct { font-size: 46px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
.pct small { font-size: 22px; font-weight: 600; color: var(--text-2); }
.pct.charging { color: var(--cheap, var(--c-charge, #34c759)); }
.car-meta { display: flex; flex-direction: column; gap: 3px; }
.status-line { font-weight: 600; }
.status-line.charging { color: var(--cheap, var(--c-charge, #34c759)); }
.status-line.plugged { color: var(--text); }
.bar { height: 8px; border-radius: 4px; background: var(--fill); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; background: var(--text-2); transition: width 0.6s var(--spring, ease); }
.bar-fill.charging { background: var(--cheap, var(--c-charge, #34c759)); }
.facts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 16px; margin: 16px 0 4px; }
.facts div { display: flex; flex-direction: column; gap: 2px; }
.facts dt { font-size: 12px; color: var(--text-2); }
.facts dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.edit { margin-top: 8px; }
.edit summary { cursor: pointer; font-size: 14px; color: var(--text-2); padding: 6px 0; }
.unit-in { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; color: var(--text-2); width: 55%; }
.unit-in input { width: 100%; }
.foot { font-size: 13px; color: var(--text-2); margin: 4px 2px 0; max-width: 60ch; }
.muted { color: var(--text-2); }
.pos { color: var(--c-ok, #34c759); }
</style>
