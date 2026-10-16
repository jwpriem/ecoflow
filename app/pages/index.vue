<template>
  <div>
    <div class="spread">
      <h1>Batteries</h1>
      <span class="muted small" v-if="d">updated {{ time(d.now) }}</span>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="d">
      <div class="grid">
        <div class="card">
          <div class="label">Saved today (solar at €0)</div>
          <div class="big" :class="(d.today?.savingNaive ?? 0) >= 0 ? 'pos' : 'neg'">{{ eur(d.today?.savingNaive ?? 0) }}</div>
          <div class="small muted">vs exporting the solar instead: {{ eur(d.today?.savingOpportunity ?? 0) }}</div>
        </div>
        <div class="card">
          <div class="label">Price now</div>
          <div class="big">{{ d.price ? eur(d.price.total, 3) : '–' }}</div>
          <div class="small muted">per kWh · feed-in {{ d.price ? eur(d.price.feedIn, 3) : '–' }}</div>
        </div>
        <div class="card">
          <div class="label">Stored</div>
          <div class="big">{{ kwh(storedKwh, 2) }}</div>
          <div class="small muted">of {{ kwh(capacityKwh, 2) }} · {{ Math.round((storedKwh / capacityKwh) * 100 || 0) }}%</div>
        </div>
      </div>

      <div class="grid">
        <div v-for="b in d.devices" :key="b.id" class="card">
          <div class="spread">
            <h2>{{ b.name }}</h2>
            <span class="pill">{{ b.driver === 'mock' ? 'simulated' : b.model }}</span>
          </div>
          <div class="spread">
            <span class="big">{{ b.soc == null ? '–' : Math.round(b.soc * 100) + '%' }}</span>
            <span class="num" :class="b.powerW > 0 ? 'pos' : b.powerW < 0 ? 'neg' : 'muted'">
              {{ b.powerW > 0 ? 'charging' : b.powerW < 0 ? 'discharging' : 'idle' }} {{ watt(Math.abs(b.powerW)) }}
            </span>
          </div>
          <div class="bar" style="margin: 8px 0 10px"><div :style="{ width: (b.soc ?? 0) * 100 + '%' }" /></div>
          <div class="small muted">
            {{ MODE_LABEL[b.mode ?? ''] ?? '–' }} · {{ kwh(((b.soc ?? 0) * b.capacityWh) / 1000) }} stored
            <template v-if="b.avgCostNaive != null"> · cost {{ eur(b.avgCostNaive, 3) }}/kWh</template>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Energy flow</h2>
        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))">
          <div>
            <div class="label">Solar</div>
            <div class="num">{{ watt(d.live?.solarW) }}</div>
            <div class="small muted">{{ d.live?.solarSource ?? 'no source' }}</div>
          </div>
          <div>
            <div class="label">Grid</div>
            <div class="num">{{ d.live ? (d.live.gridW >= 0 ? 'import ' : 'export ') + watt(Math.abs(d.live.gridW)) : '–' }}</div>
            <div class="small muted">with batteries</div>
          </div>
          <div>
            <div class="label">House net (no batteries)</div>
            <div class="num">{{ watt(d.live?.houseNetW) }}</div>
            <div class="small muted">{{ d.live?.houseSource ?? '–' }}</div>
          </div>
          <div>
            <div class="label">Batteries</div>
            <div class="num">{{ watt(totalPower) }}</div>
            <div class="small muted">+ charging</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="spread">
          <h2>Next</h2>
          <NuxtLink to="/plan" class="small">Full plan</NuxtLink>
        </div>
        <p v-if="d.site.override" class="small">
          Override: <strong>{{ MODE_LABEL[d.site.override.mode] }}</strong> until {{ time(d.site.override.until) }}
        </p>
        <p v-if="d.site.controlMode === 'manual'" class="small">Control is set to manual: monitoring only.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Price</th><th>Action</th></tr></thead>
            <tbody>
              <tr v-for="p in d.next.slice(0, 8)" :key="String(p.slotStart)">
                <td>{{ time(p.slotStart) }}</td>
                <td>{{ eur(p.price, 3) }}</td>
                <td>{{ MODE_LABEL[p.action] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="row small muted">
        <span class="pill"><span class="dot" :class="d.sources.pulse.connected ? 'ok' : ''" /> Tibber Pulse</span>
        <span v-for="i in d.sources.integrations" :key="i.provider" class="pill">
          <span class="dot" :class="i.status === 'ok' ? 'ok' : i.status === 'error' ? 'err' : ''" /> {{ i.provider }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const d = ref<any>(null)
const error = ref('')

async function load() {
  try {
    d.value = await api('/api/dashboard')
    error.value = ''
  } catch (e: any) {
    error.value = e?.data?.statusMessage || 'Could not load'
  }
}

const storedKwh = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + ((b.soc ?? 0) * b.capacityWh) / 1000, 0))
const capacityKwh = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + b.capacityWh / 1000, 0))
const totalPower = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + b.powerW, 0))

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>
