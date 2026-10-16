<template>
  <div>
    <h1>Settings</h1>

    <div v-for="i in integrations" :key="i.provider" class="card">
      <div class="spread">
        <h2>{{ INFO[i.provider]!.title }}</h2>
        <span class="pill">
          <span class="dot" :class="i.status === 'ok' ? 'ok' : i.status === 'error' ? 'err' : ''" />
          {{ i.configured ? i.status : 'not connected' }}
        </span>
      </div>
      <p class="small muted">{{ INFO[i.provider]!.help }}</p>
      <p v-if="i.lastError" class="error">{{ i.lastError }}</p>
      <p v-if="i.provider === 'tibber' && i.configured" class="small muted">
        Pulse realtime: {{ i.meta.realtime ? (i.pulse?.connected ? 'connected' : 'connecting…') : 'not available for this home' }}
      </p>

      <form @submit.prevent="save(i.provider)">
        <label v-for="f in INFO[i.provider]!.fields" :key="f.key" class="field">
          <span>{{ f.label }}</span>
          <input v-model="forms[i.provider]![f.key]" :type="f.secret ? 'password' : 'text'" :placeholder="i.configured ? '•••••• (saved, leave empty to keep)' : ''" autocomplete="off" />
        </label>
        <label v-if="i.provider === 'tibber' && (i.meta.homes as any[])?.length > 1" class="field">
          <span>Home</span>
          <select v-model="homeId">
            <option v-for="h in i.meta.homes as any[]" :key="h.id" :value="h.id">{{ h.name }}</option>
          </select>
        </label>
        <div class="row">
          <button class="primary" type="submit" :disabled="busy === i.provider">Save &amp; test</button>
          <button v-if="i.configured" type="button" @click="remove(i.provider)">Disconnect</button>
          <span v-if="results[i.provider]" class="small" :class="results[i.provider]!.ok ? 'pos' : 'error'">{{ results[i.provider]!.text }}</span>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>Batteries</h2>
      <p class="small muted">Both run on the simulated driver until the EcoFlow connection is proven (phase 0).</p>
      <div v-for="d in devs" :key="d.id" style="margin-bottom: 16px">
        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px">
          <label class="field"><span>Name</span><input v-model="d.name" /></label>
          <label class="field"><span>Capacity (Wh)</span><input v-model.number="d.capacityWh" type="number" /></label>
          <label class="field"><span>Max charge (W)</span><input v-model.number="d.maxChargeW" type="number" /></label>
          <label class="field"><span>Max discharge (W)</span><input v-model.number="d.maxDischargeW" type="number" /></label>
        </div>
        <button @click="saveDevice(d)">Save {{ d.name }}</button>
      </div>
    </div>

    <div class="card" v-if="strategy">
      <h2>Strategy</h2>
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px">
        <label class="field"><span>Backup reserve (%)</span><input v-model.number="pct.reserveSoc" type="number" min="0" max="90" /></label>
        <label class="field"><span>Max charge level (%)</span><input v-model.number="pct.maxSoc" type="number" min="50" max="100" /></label>
        <label class="field"><span>Round-trip efficiency (%)</span><input v-model.number="pct.roundTripEfficiency" type="number" min="50" max="100" /></label>
        <label class="field"><span>Min. profit per kWh (€)</span><input v-model.number="strategy.minSpread" type="number" step="0.01" /></label>
        <label class="field"><span>Typical load while discharging (W)</span><input v-model.number="strategy.avgLoadW" type="number" /></label>
        <label class="field"><span>Charge from grid when cheap</span>
          <select v-model="strategy.gridCharge"><option :value="true">Yes</option><option :value="false">No</option></select>
        </label>
        <label class="field"><span>Net metering (saldering) until</span><input v-model="strategy.feedIn.nettingUntil" type="date" /></label>
        <label class="field"><span>Feed-in after: spot × factor</span><input v-model.number="strategy.feedIn.factor" type="number" step="0.05" /></label>
        <label class="field"><span>Feed-in fee (€/kWh)</span><input v-model.number="strategy.feedIn.feeEur" type="number" step="0.005" /></label>
      </div>
      <div class="row">
        <button class="primary" @click="saveStrategy">Save strategy</button>
        <span v-if="strategyMsg" class="small pos">{{ strategyMsg }}</span>
      </div>
    </div>

    <div class="card">
      <div class="spread">
        <span class="small muted">{{ me?.email }}</span>
        <button @click="logout">Log out</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const { setToken } = useAuth()

type Field = { key: string; label: string; secret?: boolean }
const INFO: Record<string, { title: string; help: string; fields: Field[] }> = {
  tibber: {
    title: 'Tibber',
    help: 'Personal access token from developer.tibber.com. Used for 15-minute prices and the Pulse live meter.',
    fields: [{ key: 'token', label: 'Access token', secret: true }],
  },
  solaredge: {
    title: 'SolarEdge',
    help: 'Monitoring API key and site ID (monitoring portal → Admin → Site access). Polled every 6 minutes to stay under 300 calls/day.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }, { key: 'siteId', label: 'Site ID' }],
  },
  ecoflow_app: {
    title: 'EcoFlow app login',
    help: 'Stored encrypted for the phase 0 control test (unofficial MQTT route). Not used yet; the batteries are simulated.',
    fields: [{ key: 'email', label: 'EcoFlow email' }, { key: 'password', label: 'EcoFlow password', secret: true }],
  },
  ecoflow_official: {
    title: 'EcoFlow developer API',
    help: 'Access key and secret key from developer-eu.ecoflow.com. Stored for later; not used yet.',
    fields: [{ key: 'accessKey', label: 'Access key', secret: true }, { key: 'secretKey', label: 'Secret key', secret: true }],
  },
}

const integrations = ref<any[]>([])
const forms = reactive<Record<string, Record<string, string>>>({ tibber: {}, solaredge: {}, ecoflow_app: {}, ecoflow_official: {} })
const results = reactive<Record<string, { ok: boolean; text: string } | undefined>>({})
const busy = ref('')
const homeId = ref('')
const devs = ref<any[]>([])
const strategy = ref<any>(null)
const strategyMsg = ref('')
const me = ref<any>(null)

const pct = reactive({ reserveSoc: 10, maxSoc: 100, roundTripEfficiency: 85 })

async function load() {
  integrations.value = await api('/api/integrations')
  const t = integrations.value.find((i) => i.provider === 'tibber')
  homeId.value = (t?.meta.homeId as string) ?? ''
  devs.value = await api('/api/devices')
  const plan: any = await api('/api/plan')
  strategy.value = plan.strategy
  pct.reserveSoc = Math.round(plan.strategy.reserveSoc * 100)
  pct.maxSoc = Math.round(plan.strategy.maxSoc * 100)
  pct.roundTripEfficiency = Math.round(plan.strategy.roundTripEfficiency * 100)
  me.value = await api('/api/auth/me')
}

async function save(provider: string) {
  busy.value = provider
  results[provider] = undefined
  const f = forms[provider]!
  const filled = INFO[provider]!.fields.every((x) => f[x.key])
  try {
    const r: any = await api(`/api/integrations/${provider}`, {
      method: 'PUT',
      body: { ...(filled ? { credentials: f } : {}), meta: provider === 'tibber' && homeId.value ? { homeId: homeId.value } : {} },
    })
    results[provider] = r.ok ? { ok: true, text: 'Connected' } : { ok: false, text: r.error ?? 'Saved, but the test failed' }
    forms[provider] = {}
    await load()
  } catch (e: any) {
    results[provider] = { ok: false, text: e?.data?.statusMessage ?? 'Failed' }
  } finally {
    busy.value = ''
  }
}

async function remove(provider: string) {
  await api(`/api/integrations/${provider}`, { method: 'DELETE' })
  await load()
}

async function saveDevice(d: any) {
  await api(`/api/devices/${d.id}`, { method: 'PUT', body: { name: d.name, capacityWh: d.capacityWh, maxChargeW: d.maxChargeW, maxDischargeW: d.maxDischargeW } })
}

async function saveStrategy() {
  strategy.value = await api('/api/strategy', {
    method: 'PUT',
    body: { ...strategy.value, reserveSoc: pct.reserveSoc / 100, maxSoc: pct.maxSoc / 100, roundTripEfficiency: pct.roundTripEfficiency / 100 },
  })
  strategyMsg.value = 'Saved, plan rebuilt'
  setTimeout(() => (strategyMsg.value = ''), 3000)
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  setToken(null)
  await navigateTo('/login')
}

onMounted(load)
</script>
