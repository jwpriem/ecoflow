<template>
  <div>
    <header class="page-head"><h1>Settings</h1></header>
    <LoadError v-if="loadError" :error="loadError" what="your settings" :busy="busy === 'load'" @retry="retryLoad" />

    <h3 class="section-title">Energy flow</h3>
    <div class="list" role="radiogroup" aria-label="Default energy flow view">
      <button
        v-for="o in FLOW_VIEWS" :key="o.value" type="button" role="radio" class="list-row indent row-btn"
        :aria-checked="flow.defaultView.value === o.value" @click="flow.setDefault(o.value)"
      >
        <span class="lead">
          <span class="icon-tile"><AppIcon :name="o.icon" /></span>
          <span class="stack-text"><span class="title">{{ o.label }}</span><span class="small muted">{{ o.help }}</span></span>
        </span>
        <AppIcon v-if="flow.defaultView.value === o.value" name="check" class="check" />
      </button>
      <label class="list-row indent">
        <span class="lead">
          <span class="icon-tile"><AppIcon name="wave" /></span>
          <span class="title">Animate flow</span>
        </span>
        <span class="switch"><input type="checkbox" :checked="flow.animate.value" @change="flow.setAnimate(($event.target as HTMLInputElement).checked)" /><span /></span>
      </label>
    </div>
    <p class="foot">How Energy flow opens on this device. You can still switch on the Home page. Flow lines stay still when Reduce Motion is on.</p>

    <h3 class="section-title">Connections</h3>
    <div class="list">
      <details v-for="i in integrations" :key="i.provider" class="conn" :open="i.provider === 'solaredge' && !!results.solaredge">
        <summary class="list-row indent">
          <div class="lead">
            <span class="icon-tile"><AppIcon :name="INFO[i.provider]!.icon" /></span>
            <span class="title">{{ INFO[i.provider]!.title }}</span>
          </div>
          <span class="detail row" style="gap: 6px">
            <span class="dot" :class="i.status === 'ok' ? 'ok' : i.status === 'error' ? 'err' : ''" />
            {{ i.configured ? i.status : 'Off' }}
            <AppIcon name="chevron" class="chev" />
          </span>
        </summary>
        <form class="conn-body" @submit.prevent="save(i.provider)">
          <p class="small muted">{{ INFO[i.provider]!.help }}</p>
          <p v-if="i.lastError" class="error">{{ i.lastError }}</p>
          <p v-if="i.provider === 'tibber' && i.configured" class="small muted">
            Pulse realtime: {{ i.meta.realtime ? (i.pulse?.connected ? 'connected' : 'connecting…') : 'not available for this home' }}
          </p>
          <template v-if="i.provider === 'solaredge'">
            <p class="small muted">Redirect URI to register in the developer console: <code class="copy">{{ i.redirectUri }}</code></p>
            <p v-if="i.configured" class="small muted">
              {{ i.meta.authorized ? `Site ${i.meta.siteId}${(i.meta.lastTest as any)?.name ? ` · ${(i.meta.lastTest as any).name}` : ''}` : 'Not signed in with SolarEdge yet.' }}
              <template v-if="i.meta.credits">
                · Credits today {{ i.credits.today }}/{{ i.credits.dailyCap }}, {{ (i.meta.credits as any).month }}: {{ (i.meta.credits as any).monthUsed }}/{{ i.credits.monthly }}
              </template>
            </p>
          </template>
          <label v-for="f in INFO[i.provider]!.fields" :key="f.key" class="field">
            <span>{{ f.label }}</span>
            <input v-model="forms[i.provider]![f.key]" :type="f.secret ? 'password' : 'text'" :placeholder="i.configured ? 'Saved · leave empty to keep' : ''" autocomplete="off" />
          </label>
          <label v-if="i.provider === 'tibber' && (i.meta.homes as any[])?.length > 1" class="field">
            <span>Home</span>
            <select v-model="homeId">
              <option v-for="h in i.meta.homes as any[]" :key="h.id" :value="h.id">{{ h.name }}</option>
            </select>
          </label>
          <div class="row">
            <button class="primary" type="submit" :disabled="busy === i.provider">{{ busy === i.provider ? 'Testing…' : 'Save & test' }}</button>
            <button v-if="i.provider === 'solaredge' && i.configured" type="button" :disabled="busy === 'se-auth'" @click="signInSolarEdge">
              {{ i.meta.authorized ? 'Sign in again' : 'Sign in with SolarEdge' }}
            </button>
            <button v-if="i.configured" type="button" class="danger" @click="remove(i.provider)">Disconnect</button>
            <span v-if="results[i.provider]" class="small" :class="results[i.provider]!.ok ? 'pos' : 'error'">{{ results[i.provider]!.text }}</span>
          </div>
        </form>
      </details>
    </div>

    <template v-for="d in devs" :key="d.id">
      <h3 class="section-title">{{ d.name || 'Battery' }}</h3>
      <div class="list">
        <label class="list-row"><span class="title">Name</span><input v-model="d.name" /></label>
        <label class="list-row"><span class="title">Capacity</span><span class="unit-in"><input v-model.number="d.capacityWh" type="number" inputmode="numeric" /> Wh</span></label>
        <label class="list-row"><span class="title">Max charge</span><span class="unit-in"><input v-model.number="d.maxChargeW" type="number" inputmode="numeric" /> W</span></label>
        <label class="list-row"><span class="title">Max discharge</span><span class="unit-in"><input v-model.number="d.maxDischargeW" type="number" inputmode="numeric" /> W</span></label>
        <div class="list-row"><button class="plain" @click="saveDevice(d)">Save {{ d.name }}</button><span v-if="deviceMsg === d.id" class="small pos">Saved</span></div>
      </div>
    </template>
    <p v-if="!devs.length && !loadError" class="foot">No batteries yet: save the EcoFlow developer API keys above to add the STREAM units on your account.</p>
    <p v-else class="foot">Read live through the EcoFlow developer API. Choose who steers them (EcoFlow AI or WattWise) on the Plan page.</p>

    <template v-if="strategy">
      <h3 class="section-title">Strategy</h3>
      <div class="list">
        <div class="list-row stack">
          <div class="spread"><span class="title">Backup reserve</span><span class="detail">{{ pct.reserveSoc }}%</span></div>
          <input v-model.number="pct.reserveSoc" type="range" min="0" max="90" step="5" class="range" :style="{ '--p': pct.reserveSoc / 90 }" />
        </div>
        <div class="list-row stack">
          <div class="spread"><span class="title">Max charge level</span><span class="detail">{{ pct.maxSoc }}%</span></div>
          <input v-model.number="pct.maxSoc" type="range" min="50" max="100" step="5" class="range" :style="{ '--p': (pct.maxSoc - 50) / 50 }" />
        </div>
        <div class="list-row stack">
          <div class="spread"><span class="title">Round-trip efficiency</span><span class="detail">{{ pct.roundTripEfficiency }}%</span></div>
          <input v-model.number="pct.roundTripEfficiency" type="range" min="50" max="100" class="range" :style="{ '--p': (pct.roundTripEfficiency - 50) / 50 }" />
        </div>
        <label class="list-row"><span class="title">Charge from grid when cheap</span><span class="switch"><input v-model="strategy.gridCharge" type="checkbox" /><span /></span></label>
        <label class="list-row"><span class="title">Min. profit</span><span class="unit-in">€ <input v-model.number="strategy.minSpread" type="number" step="0.01" inputmode="decimal" /> /kWh</span></label>
        <label class="list-row"><span class="title">Typical load</span><span class="unit-in"><input v-model.number="strategy.avgLoadW" type="number" inputmode="numeric" /> W</span></label>
      </div>

      <h3 class="section-title">Feed-in</h3>
      <div class="list">
        <label class="list-row"><span class="title">Net metering until</span><input v-model="strategy.feedIn.nettingUntil" type="date" /></label>
        <label class="list-row"><span class="title">After: spot ×</span><input v-model.number="strategy.feedIn.factor" type="number" step="0.05" inputmode="decimal" /></label>
        <label class="list-row"><span class="title">Fee</span><span class="unit-in">€ <input v-model.number="strategy.feedIn.feeEur" type="number" step="0.005" inputmode="decimal" /> /kWh</span></label>
      </div>
      <button class="primary wide" @click="saveStrategy">{{ strategyMsg || 'Save strategy' }}</button>
    </template>

    <h3 class="section-title">Notifications</h3>
    <div class="list">
      <div v-if="push.state.value === 'loading'" class="list-row"><span class="muted">Checking…</span></div>
      <div v-else-if="push.state.value === 'install'" class="list-row stack">
        <span class="title">Add WattWise to your Home Screen</span>
        <span class="small muted">On iPhone, notifications only work from the Home Screen app (iOS 16.4 or later). In Safari tap Share, then <b>Add to Home Screen</b>, open WattWise from there and come back to this page.</span>
      </div>
      <div v-else-if="push.state.value === 'unsupported'" class="list-row"><span class="small muted">This browser can't receive notifications.</span></div>
      <div v-else-if="push.state.value === 'denied'" class="list-row stack">
        <span class="title">Notifications are blocked</span>
        <span class="small muted">{{ push.isIos() ? 'Allow them in the iPhone Settings app → Notifications → WattWise, then reopen the app.' : 'Allow notifications for this site in your browser settings, then reload.' }}</span>
      </div>
      <div v-else-if="push.state.value === 'off'" class="list-row"><button class="plain" :disabled="push.busy.value" @click="push.enable()">{{ push.busy.value ? 'Turning on…' : 'Turn on notifications' }}</button></div>
      <template v-else>
        <label v-for="t in PUSH_TOPICS" :key="t.key" class="list-row">
          <span class="stack-text"><span class="title">{{ t.label }}</span><span class="small muted">{{ t.help }}</span></span>
          <span class="switch"><input type="checkbox" :checked="push.topics.value.includes(t.key)" @change="push.toggleTopic(t.key, ($event.target as HTMLInputElement).checked)" /><span /></span>
        </label>
        <div class="list-row"><button class="plain" :disabled="push.busy.value" @click="push.test()">{{ push.busy.value ? 'Sending…' : 'Send a test notification' }}</button></div>
        <div class="list-row"><button class="plain danger" @click="push.disable()">Turn off on this device</button></div>
      </template>
    </div>
    <p v-if="push.error.value" class="foot error">{{ push.error.value }}</p>

    <h3 class="section-title">Account</h3>
    <div class="list">
      <div class="list-row indent">
        <div class="lead"><span class="icon-tile"><AppIcon name="person" /></span><span class="title">{{ me?.email }}</span></div>
      </div>
      <div class="list-row"><button class="plain danger" @click="logout">Log out</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
const flow = useFlowView()
const FLOW_VIEWS = [
  { value: 'clean', label: 'Clean', help: 'Sources and live values', icon: 'nodes', tile: 'var(--surface-3)' },
  { value: 'detailed', label: 'House', help: 'Your house, the sky over it and where power comes from', icon: 'house', tile: 'var(--sys-blue)' },
] as const
const api = useApi()
const { setToken } = useAuth()
const push = usePush()

type Field = { key: string; label: string; secret?: boolean }
const INFO: Record<string, { title: string; help: string; icon: string; tile: string; fields: Field[] }> = {
  tibber: {
    title: 'Tibber',
    icon: 'bolt',
    tile: 'var(--sys-blue)',
    help: 'Personal access token from developer.tibber.com. Used for 15-minute prices and the Pulse live meter.',
    fields: [{ key: 'token', label: 'Access token', secret: true }],
  },
  solaredge: {
    title: 'SolarEdge',
    icon: 'sun',
    tile: 'var(--c-discharge)',
    help: 'Monitoring API v2. Create a Site Access application at developer.solaredge.com with the redirect URI below, save its client ID and secret here, then sign in with SolarEdge to grant access. Read every 20 minutes from 05:00 to 22:00: at most 64 credits a day, so the Free tier (2,000 a month) is never exceeded.',
    fields: [{ key: 'clientId', label: 'Client ID' }, { key: 'clientSecret', label: 'Client secret', secret: true }],
  },
  ecoflow_official: {
    title: 'EcoFlow developer API',
    icon: 'key',
    tile: 'var(--surface-3)',
    help: 'Access key and secret key from developer-eu.ecoflow.com. Reads charge level, battery power and PV of every STREAM unit on the account, once a minute.',
    fields: [{ key: 'accessKey', label: 'Access key', secret: true }, { key: 'secretKey', label: 'Secret key', secret: true }],
  },
}

const integrations = ref<any[]>([])
const forms = reactive<Record<string, Record<string, string>>>({ tibber: {}, solaredge: {}, ecoflow_official: {} })
const results = reactive<Record<string, { ok: boolean; text: string } | undefined>>({})
const busy = ref('')
const homeId = ref('')
const devs = ref<any[]>([])
const strategy = ref<any>(null)
const strategyMsg = ref('')
const me = ref<any>(null)
const deviceMsg = ref<number | null>(null)

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
    if (typeof r !== 'object' || r === null) throw new Error('Unexpected response from the server')
    results[provider] = !r.ok
      ? { ok: false, text: r.error ?? 'Saved, but the test failed' }
      : { ok: true, text: provider === 'solaredge' && !r.meta.authorized ? 'Saved · now sign in with SolarEdge' : 'Connected' }
    forms[provider] = {}
    await load()
  } catch (e: any) {
    results[provider] = { ok: false, text: e?.data?.statusMessage ?? e?.message ?? 'Failed' }
  } finally {
    busy.value = ''
  }
}

async function signInSolarEdge() {
  busy.value = 'se-auth'
  try {
    const r: any = await api('/api/integrations/solaredge/authorize')
    window.location.href = r.url
  } catch (e: any) {
    results.solaredge = { ok: false, text: e?.data?.statusMessage ?? 'Failed' }
    busy.value = ''
  }
}

async function remove(provider: string) {
  await api(`/api/integrations/${provider}`, { method: 'DELETE' })
  await load()
}

async function saveDevice(d: any) {
  await api(`/api/devices/${d.id}`, { method: 'PUT', body: { name: d.name, capacityWh: d.capacityWh, maxChargeW: d.maxChargeW, maxDischargeW: d.maxDischargeW } })
  deviceMsg.value = d.id
  setTimeout(() => (deviceMsg.value = null), 2500)
}

async function saveStrategy() {
  strategy.value = await api('/api/strategy', {
    method: 'PUT',
    body: { ...strategy.value, reserveSoc: pct.reserveSoc / 100, maxSoc: pct.maxSoc / 100, roundTripEfficiency: pct.roundTripEfficiency / 100 },
  })
  strategyMsg.value = 'Saved · plan rebuilt'
  setTimeout(() => (strategyMsg.value = ''), 3000)
}

async function logout() {
  await push.disable().catch(() => undefined)
  await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  setToken(null)
  await navigateTo('/login')
}

const loadError = ref<any>(null)
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

onMounted(async () => {
  // Back from SolarEdge Connect: /settings?solaredge=ok or ?solaredge=<error>
  const route = useRoute()
  const se = route.query.solaredge
  if (typeof se === 'string') {
    results.solaredge = se === 'ok' ? { ok: true, text: 'Connected' } : { ok: false, text: se }
    navigateTo({ query: {} }, { replace: true })
  }
  push.init().catch(() => (push.state.value = 'unsupported'))
  await safeLoad()
  // Sign-in may finish in another window or on another device: refresh when the page is shown again
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

function onVisible() {
  if (document.visibilityState === 'visible' && !busy.value) safeLoad()
}
</script>

<style scoped>
.row-btn { width: 100%; background: none; border-radius: 0; text-align: left; font: inherit; color: var(--text); }
.row-btn:active { transform: none; background: var(--fill-2); }
.check { width: 20px; height: 20px; color: var(--text); stroke-width: 2.4; flex: none; }
.conn > summary { list-style: none; cursor: pointer; }
.conn > summary::-webkit-details-marker { display: none; }
.conn + .conn > summary::before { content: ''; position: absolute; top: 0; left: 56px; right: 0; height: 1px; background: var(--rule); }
.chev { width: 16px; height: 16px; color: var(--muted); transition: transform 0.3s var(--spring); }
.conn[open] .chev { transform: rotate(90deg); }
.conn .lead { flex: 1; }
.conn .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conn .detail { white-space: nowrap; flex: none; }
.conn-body { padding: 4px 16px 16px; }
.conn-body p { margin: 0 0 12px; }
.unit-in { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; color: var(--text-2); width: 55%; }
.unit-in input { width: 100%; }
.copy { user-select: all; word-break: break-all; }
.foot { font-size: 13px; color: var(--text-2); margin: -4px 2px 0; max-width: 60ch; }
.wide { width: 100%; margin-top: 4px; padding: 13px; }
.stack-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding-right: 12px; }
.list-row input.range { -webkit-appearance: none; appearance: none; height: 4px; padding: 0; border-radius: 2px; margin: 10px 0 6px; background: linear-gradient(90deg, var(--text) calc(var(--p) * 100%), var(--fill) 0); }
.range::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: var(--surface); border: 2px solid var(--text); }
.range::-moz-range-thumb { width: 18px; height: 18px; border: 2px solid var(--text); border-radius: 50%; background: var(--surface); }
.range:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--text); outline-offset: 2px; }
.list-row input.range:focus { box-shadow: none; }
</style>
