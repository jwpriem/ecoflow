<template>
  <div>
    <header class="page-head"><h1>{{ m.settings.title }}</h1></header>
    <LoadError v-if="loadError" :error="loadError" :what="m.load.what.settings" :busy="busy === 'load'" @retry="retryLoad" />

    <!-- On a large screen: how WattsWise runs on the left, what it connects to (accounts, batteries, this device) on the right.
         On a phone the groups keep one column, in the order set by --o -->
    <div class="groups">
      <div class="col">
      <!-- Who steers: one decision with three outcomes -->
      <section v-if="control && devs.length" class="group" style="--o: 2">
        <h3 class="section-title">{{ m.settings.whoSteers }}</h3>
        <div class="list" role="radiogroup" :aria-label="m.settings.whoSteers">
          <button
            v-for="o in controlOptions" :key="o" type="button" role="radio" class="list-row row-btn"
            :aria-checked="controlChoice === o" :disabled="busy === 'control'" @click="setControl(o)"
          >
            <span class="stack-text"><span class="title">{{ m.settings.control[o].label }}</span><span class="small muted">{{ m.settings.control[o].help }}</span></span>
            <AppIcon v-if="controlChoice === o" name="check" class="check" />
          </button>
        </div>
        <p class="foot" :class="{ error: controlMsg && !controlMsg.ok }" role="status">{{ busy === 'control' ? m.settings.switching : controlMsg?.text ?? m.settings.controlFoot }}</p>
      </section>
      <section v-if="strategy" class="group" style="--o: 3">
        <h3 class="section-title">{{ m.settings.strategy }}</h3>
        <div class="list" @change="saveStrategySoon">
          <div class="list-row stack">
            <div class="spread"><span class="title">{{ m.settings.reserve }}</span><span class="detail">{{ pct.reserveSoc }}%</span></div>
            <input v-model.number="pct.reserveSoc" type="range" min="0" max="90" step="5" class="range" :style="{ '--p': pct.reserveSoc / 90 }" :aria-label="m.settings.reserve" />
            <span class="small muted">{{ m.settings.help.reserve }}</span>
          </div>
          <div class="list-row stack">
            <div class="spread"><span class="title">{{ m.settings.maxSoc }}</span><span class="detail">{{ pct.maxSoc }}%</span></div>
            <input v-model.number="pct.maxSoc" type="range" min="50" max="100" step="5" class="range" :style="{ '--p': (pct.maxSoc - 50) / 50 }" :aria-label="m.settings.maxSoc" />
            <span class="small muted">{{ m.settings.help.maxSoc }}</span>
          </div>
          <div class="list-row stack">
            <div class="spread"><span class="title">{{ m.settings.efficiency }}</span><span class="detail">{{ pct.roundTripEfficiency }}%</span></div>
            <input v-model.number="pct.roundTripEfficiency" type="range" min="50" max="100" class="range" :style="{ '--p': (pct.roundTripEfficiency - 50) / 50 }" :aria-label="m.settings.efficiency" />
            <span class="small muted">{{ m.settings.help.efficiency }}</span>
          </div>
          <label class="list-row">
            <span class="stack-text"><span class="title">{{ m.settings.gridCharge }}</span><span class="small muted">{{ m.settings.help.gridCharge }}</span></span>
            <span class="switch"><input v-model="strategy.gridCharge" type="checkbox" /><span /></span>
          </label>
          <label class="list-row">
            <span class="stack-text"><span class="title">{{ m.settings.minProfit }}</span><span class="small muted">{{ m.settings.help.minProfit }}</span></span>
            <span class="unit-in">€ <input v-model.number="strategy.minSpread" type="number" step="0.01" inputmode="decimal" /> /kWh</span>
          </label>
          <label class="list-row">
            <span class="stack-text"><span class="title">{{ m.settings.typicalLoad }}</span><span class="small muted">{{ m.settings.help.typicalLoad }}</span></span>
            <span class="unit-in"><input v-model.number="strategy.avgLoadW" type="number" inputmode="numeric" /> W</span>
          </label>
          <label class="list-row">
            <span class="stack-text"><span class="title">{{ m.settings.maxOutput }}</span><span class="small muted">{{ m.settings.help.maxOutput }}</span></span>
            <span class="unit-in"><input v-model.number="strategy.maxOutputW" type="number" inputmode="numeric" /> W</span>
          </label>
          <label class="list-row">
            <span class="stack-text"><span class="title">{{ m.settings.dailyCycle }}</span><span class="small muted">{{ m.settings.help.dailyCycle }}</span></span>
            <span class="unit-in"><input v-model.number="strategy.dailyCycleKwh" type="number" step="0.1" inputmode="decimal" /> kWh</span>
          </label>
        </div>

        <h3 class="section-title">{{ m.settings.feedIn }}</h3>
        <div class="list" @change="saveStrategySoon">
          <label class="list-row">
            <span class="stack-text"><span class="title">{{ m.settings.nettingUntil }}</span><span class="small muted">{{ m.settings.help.nettingUntil }}</span></span>
            <input v-model="strategy.feedIn.nettingUntil" type="date" />
          </label>
          <label class="list-row">
            <span class="stack-text"><span class="title">{{ m.settings.afterFactor }}</span><span class="small muted">{{ m.settings.help.afterFactor }}</span></span>
            <span class="unit-in">× <input v-model.number="strategy.feedIn.factor" type="number" step="0.05" inputmode="decimal" /></span>
          </label>
          <label class="list-row">
            <span class="stack-text"><span class="title">{{ m.settings.fee }}</span><span class="small muted">{{ m.settings.help.fee }}</span></span>
            <span class="unit-in">€ <input v-model.number="strategy.feedIn.feeEur" type="number" step="0.005" inputmode="decimal" /> /kWh</span>
          </label>
        </div>
        <p class="foot" :class="{ error: strategyMsg && !strategyMsg.ok }" role="status">{{ strategyMsg?.text ?? m.settings.strategyFoot }}</p>
      </section>
      <section class="group" style="--o: 4">
        <h3 class="section-title">{{ m.settings.solarSavings }}</h3>
        <div class="list" role="radiogroup" :aria-label="m.settings.solarAria">
          <button
            v-for="o in SOLAR_COUNTS" :key="o" type="button" role="radio" class="list-row indent row-btn"
            :aria-checked="solar.count.value === o" @click="solar.setCount(o)"
          >
            <span class="lead">
              <span class="icon-tile"><AppIcon :name="o === 'house' ? 'house' : o === 'fed_in' ? 'grid' : 'sun'" /></span>
              <span class="stack-text"><span class="title">{{ m.solarCount[o].label }}</span><span class="small muted">{{ m.solarCount[o].help }}</span></span>
            </span>
            <AppIcon v-if="solar.count.value === o" name="check" class="check" />
          </button>
        </div>
        <p class="foot">{{ m.settings.solarFoot }}</p>
      </section>
      </div>
      <div class="col">
      <section class="group" style="--o: 5">
        <h3 class="section-title">{{ m.settings.connections }}</h3>
        <div class="list">
          <details v-for="i in integrations" :key="i.provider" class="conn" :open="i.provider === 'solaredge' && !!results.solaredge">
            <summary class="list-row indent">
              <div class="lead">
                <span class="icon-tile"><AppIcon :name="INFO[i.provider]!.icon" /></span>
                <span class="title">{{ m.settings.info[i.provider]!.title }}</span>
              </div>
              <span class="detail row" style="gap: 6px">
                <span class="dot" :class="i.status === 'ok' ? 'ok' : i.status === 'error' ? 'err' : ''" />
                {{ i.configured ? (m.settings.status[i.status] ?? i.status) : m.settings.status.off }}
                <AppIcon name="chevron" class="chev" />
              </span>
            </summary>
            <form class="conn-body" @submit.prevent="save(i.provider)">
              <p class="small muted">{{ m.settings.info[i.provider]!.help }}</p>
              <p v-if="i.lastError" class="error">{{ i.lastError }}</p>
              <p v-if="i.provider === 'tibber' && i.configured" class="small muted">
                {{ m.settings.pulse(i.meta.realtime ? (i.pulse?.connected ? m.settings.pulseConnected : m.settings.pulseConnecting) : m.settings.pulseNone) }}
              </p>
              <template v-if="i.provider === 'solaredge'">
                <p class="small muted">{{ m.settings.redirectUri }} <code class="copy">{{ i.redirectUri }}</code></p>
                <p v-if="i.configured" class="small muted">
                  {{ i.meta.authorized ? `${m.settings.site(String(i.meta.siteId))}${(i.meta.lastTest as any)?.name ? `, ${(i.meta.lastTest as any).name}` : ''}.` : m.settings.notSignedIn }}
                  <template v-if="i.meta.credits">
                    {{ m.settings.credits(i.credits.today, i.credits.dailyCap, (i.meta.credits as any).month, (i.meta.credits as any).monthUsed, i.credits.monthly) }}
                  </template>
                </p>
              </template>
              <p v-if="i.provider === 'tibber_app' && i.configured" class="small muted">
                {{ m.settings.tibberApp((i.meta.vehicles as any[])?.length ?? 0, (i.meta.chargers as any[])?.length ?? 0) }}
              </p>
              <label v-for="f in INFO[i.provider]!.fields" :key="f.key" class="field">
                <span>{{ m.settings.fields[f.key] ?? f.key }}</span>
                <input v-model="forms[i.provider]![f.key]" :type="f.secret ? 'password' : 'text'" :placeholder="i.configured ? m.settings.keepSaved : ''" autocomplete="off" />
              </label>
              <label v-if="i.provider === 'tibber' && (i.meta.homes as any[])?.length > 1" class="field">
                <span>{{ m.settings.home }}</span>
                <select v-model="homeId">
                  <option v-for="h in i.meta.homes as any[]" :key="h.id" :value="h.id">{{ h.name }}</option>
                </select>
              </label>
              <div class="row">
                <button class="primary" type="submit" :disabled="busy === i.provider">{{ busy === i.provider ? m.settings.testing : m.settings.saveTest }}</button>
                <button v-if="i.provider === 'solaredge' && i.configured" type="button" :disabled="busy === 'se-auth'" @click="signInSolarEdge">
                  {{ i.meta.authorized ? m.settings.signInAgain : m.settings.signIn }}
                </button>
                <button v-if="i.configured" type="button" class="danger" @click="remove(i.provider)">{{ m.settings.disconnect }}</button>
                <span v-if="results[i.provider]" class="small" :class="results[i.provider]!.ok ? 'pos' : 'error'">{{ results[i.provider]!.text }}</span>
              </div>
            </form>
          </details>
        </div>
      </section>
      <section class="group" style="--o: 6">
        <template v-for="d in devs" :key="d.id">
          <h3 class="section-title">{{ d.name || m.settings.battery }}</h3>
          <div class="list" @change="saveDevice(d)">
            <label class="list-row"><span class="title">{{ m.settings.name }}</span><input v-model="d.name" /></label>
            <label class="list-row"><span class="title">{{ m.settings.capacity }}</span><span class="unit-in"><input v-model.number="d.capacityWh" type="number" inputmode="numeric" /> Wh</span></label>
            <label class="list-row"><span class="title">{{ m.settings.maxCharge }}</span><span class="unit-in"><input v-model.number="d.maxChargeW" type="number" inputmode="numeric" /> W</span></label>
            <label class="list-row"><span class="title">{{ m.settings.maxDischarge }}</span><span class="unit-in"><input v-model.number="d.maxDischargeW" type="number" inputmode="numeric" /> W</span></label>
          </div>
          <p v-if="deviceMsg?.id === d.id" class="foot" :class="{ error: deviceMsg?.ok === false }" role="status">{{ deviceMsg?.text }}</p>
        </template>
        <p v-if="!devs.length && !loadError" class="foot">{{ m.settings.noBatteries }}</p>
        <p v-else class="foot">{{ m.settings.batteriesFoot }}</p>
      </section>
      <section class="group" style="--o: 7">
        <h3 class="section-title">{{ m.settings.notifications }}</h3>
        <div class="list">
          <div v-if="push.state.value === 'loading'" class="list-row"><span class="muted">{{ m.settings.checking }}</span></div>
          <div v-else-if="push.state.value === 'install'" class="list-row stack">
            <span class="title">{{ m.settings.installTitle }}</span>
            <span class="small muted">{{ m.settings.installText }}</span>
          </div>
          <div v-else-if="push.state.value === 'unsupported'" class="list-row"><span class="small muted">{{ m.settings.unsupported }}</span></div>
          <div v-else-if="push.state.value === 'denied'" class="list-row stack">
            <span class="title">{{ m.settings.blocked }}</span>
            <span class="small muted">{{ push.isIos() ? m.settings.blockedIos : m.settings.blockedWeb }}</span>
          </div>
          <div v-else-if="push.state.value === 'off'" class="list-row"><button class="plain" :disabled="push.busy.value" @click="push.enable()">{{ push.busy.value ? m.settings.turningOn : m.settings.turnOn }}</button></div>
          <template v-else>
            <label v-for="t in PUSH_TOPICS" :key="t" class="list-row">
              <span class="stack-text"><span class="title">{{ m.push.topics[t].label }}</span><span class="small muted">{{ m.push.topics[t].help }}</span></span>
              <span class="switch"><input type="checkbox" :checked="push.topics.value.includes(t)" @change="push.toggleTopic(t, ($event.target as HTMLInputElement).checked)" /><span /></span>
            </label>
            <div class="list-row"><button class="plain" :disabled="push.busy.value" @click="push.test()">{{ push.busy.value ? m.settings.sending : m.settings.sendTest }}</button></div>
            <div class="list-row"><button class="plain danger" @click="push.disable()">{{ m.settings.turnOff }}</button></div>
          </template>
        </div>
        <p v-if="push.error.value" class="foot error">{{ push.error.value }}</p>
      </section>
      <section class="group" style="--o: 8">
        <h3 class="section-title">{{ m.settings.display }}</h3>
        <div class="list">
          <label class="list-row">
            <span class="title">{{ m.settings.animate }}</span>
            <span class="switch"><input type="checkbox" :checked="flow.animate.value" @change="flow.setAnimate(($event.target as HTMLInputElement).checked)" /><span /></span>
          </label>
        </div>
        <p class="foot">{{ m.settings.displayFoot }}</p>
      </section>
      <section class="group" style="--o: 1">
        <h3 class="section-title">{{ m.settings.language }}</h3>
        <div class="list" role="radiogroup" :aria-label="m.settings.language">
          <button
            v-for="o in LANGUAGES" :key="o.value" type="button" role="radio" class="list-row indent row-btn" :lang="o.value"
            :aria-checked="locale === o.value" @click="pickLocale(o.value)"
          >
            <span class="lead">
              <span class="icon-tile lang-tile">{{ o.value.toUpperCase() }}</span>
              <span class="title">{{ o.label }}</span>
            </span>
            <AppIcon v-if="locale === o.value" name="check" class="check" />
          </button>
        </div>
        <p class="foot">{{ m.settings.languageFoot }}</p>
      </section>
      <section class="group" style="--o: 9">
        <h3 class="section-title">{{ m.settings.account }}</h3>
        <div class="list">
          <div class="list-row indent">
            <div class="lead"><span class="icon-tile"><AppIcon name="person" /></span><span class="title">{{ me?.email }}</span></div>
          </div>
          <div class="list-row"><button class="plain danger" @click="logout">{{ m.settings.logOut }}</button></div>
        </div>
      </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Locale } from '~/composables/useLocale'
const flow = useFlowView()
const solar = useSolarCount()
const { m, locale, setLocale, serverText } = useLocale()
const api = useApi()
const { setToken } = useAuth()
const push = usePush()

function pickLocale(l: Locale) {
  setLocale(l)
  // Notifications on this device follow the new language
  push.syncLocale()
}

// Titles, help texts and field labels are in m.settings
type Field = { key: string; secret?: boolean }
const INFO: Record<string, { icon: string; tile: string; fields: Field[] }> = {
  tibber: { icon: 'bolt', tile: 'var(--sys-blue)', fields: [{ key: 'token', secret: true }] },
  solaredge: { icon: 'sun', tile: 'var(--c-discharge)', fields: [{ key: 'clientId' }, { key: 'clientSecret', secret: true }] },
  ecoflow_official: { icon: 'key', tile: 'var(--surface-3)', fields: [{ key: 'accessKey', secret: true }, { key: 'secretKey', secret: true }] },
  zeekr: {
    icon: 'car',
    tile: 'var(--sys-blue)',
    fields: [
      { key: 'username' },
      { key: 'password', secret: true },
      { key: 'hmacAccessKey', secret: true },
      { key: 'hmacSecretKey', secret: true },
      { key: 'passwordPublicKey', secret: true },
      { key: 'prodSecret', secret: true },
      { key: 'vinKey', secret: true },
      { key: 'vinIv', secret: true },
    ],
  },
  tibber_app: { icon: 'plug', tile: 'var(--sys-blue)', fields: [{ key: 'email' }, { key: 'password', secret: true }] },
}

const integrations = ref<any[]>([])
const forms = reactive<Record<string, Record<string, string>>>({ tibber: {}, solaredge: {}, ecoflow_official: {}, zeekr: {}, tibber_app: {} })
const results = reactive<Record<string, { ok: boolean; text: string } | undefined>>({})
const busy = ref('')
const homeId = ref('')
const devs = ref<any[]>([])
const strategy = ref<any>(null)
type Msg = { ok: boolean; text: string } | null
const strategyMsg = ref<Msg>(null)
const me = ref<any>(null)
const deviceMsg = ref<{ id: number; ok: boolean; text: string } | null>(null)

const pct = reactive({ reserveSoc: 10, maxSoc: 100, roundTripEfficiency: 85 })

// Steering and Follow/Monitor are one decision for the person: who decides what the batteries do
type Control = 'ecoflow_ai' | 'wattwise' | 'monitor'
const control = ref<{ steering: 'ecoflow_ai' | 'wattwise' | null; controlMode: 'auto' | 'manual' } | null>(null)
const controlMsg = ref<Msg>(null)
const controlChoice = computed<Control | null>(() => {
  if (!control.value) return null
  if (control.value.steering === 'ecoflow_ai') return 'ecoflow_ai'
  return control.value.controlMode === 'manual' ? 'monitor' : 'wattwise'
})
// EcoFlow AI is only a choice when the EcoFlow developer API is connected
const controlOptions = computed<Control[]>(() => [...(control.value?.steering ? ['ecoflow_ai' as const] : []), 'wattwise', 'monitor'])

async function setControl(v: Control) {
  const cur = control.value
  if (!cur || v === controlChoice.value) return
  busy.value = 'control'
  controlMsg.value = null
  const steer = (steering: string) => api('/api/ecoflow/steering', { method: 'PUT', body: { steering } })
  const mode = (controlMode: string) => api('/api/plan/override', { method: 'POST', body: { controlMode } })
  try {
    if (v === 'ecoflow_ai') await steer('ecoflow_ai')
    else if (v === 'monitor') {
      // Stop sending first, so handing over from EcoFlow AI doesn't push a plan step on the way
      if (cur.controlMode !== 'manual') await mode('manual')
      if (cur.steering === 'ecoflow_ai') await steer('wattwise')
    } else {
      if (cur.steering === 'ecoflow_ai') await steer('wattwise')
      if (cur.controlMode !== 'auto') await mode('auto')
    }
    controlMsg.value = { ok: true, text: m.value.settings.controlDone[v] }
  } catch (e: any) {
    controlMsg.value = { ok: false, text: serverText(e?.data?.statusMessage) || e?.message || m.value.settings.switchFailed }
  } finally {
    const plan: any = await api('/api/plan').catch(() => null)
    if (plan) control.value = { steering: plan.steering, controlMode: plan.controlMode }
    busy.value = ''
  }
}

async function load() {
  integrations.value = await api('/api/integrations')
  const t = integrations.value.find((i) => i.provider === 'tibber')
  homeId.value = (t?.meta.homeId as string) ?? ''
  devs.value = await api('/api/devices')
  const plan: any = await api('/api/plan')
  control.value = { steering: plan.steering, controlMode: plan.controlMode }
  setStrategy(plan.strategy)
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
    if (typeof r !== 'object' || r === null) throw new Error(m.value.settings.unexpected)
    results[provider] = !r.ok
      ? { ok: false, text: r.error ?? m.value.settings.testFailed }
      : { ok: true, text: provider === 'solaredge' && !r.meta.authorized ? m.value.settings.nowSignIn : m.value.settings.connected }
    forms[provider] = {}
    await load()
  } catch (e: any) {
    results[provider] = { ok: false, text: serverText(e?.data?.statusMessage) || e?.message || m.value.common.failed }
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
    results.solaredge = { ok: false, text: serverText(e?.data?.statusMessage) || m.value.common.failed }
    busy.value = ''
  }
}

async function remove(provider: string) {
  await api(`/api/integrations/${provider}`, { method: 'DELETE' })
  await load()
}

// Settings save as they change (on change, not on every keystroke); the line under each group says what happened
const whyNot = (e: any) => m.value.settings.notSaved(serverText(e?.data?.statusMessage) || m.value.settings.noAnswer)
async function saveDevice(d: any) {
  try {
    await api(`/api/devices/${d.id}`, { method: 'PUT', body: { name: d.name, capacityWh: d.capacityWh, maxChargeW: d.maxChargeW, maxDischargeW: d.maxDischargeW } })
    deviceMsg.value = { id: d.id, ok: true, text: m.value.settings.deviceSaved(d.name || m.value.settings.battery) }
  } catch (e: any) {
    deviceMsg.value = { id: d.id, ok: false, text: whyNot(e) }
  }
}

function setStrategy(s: any) {
  strategy.value = s
  pct.reserveSoc = Math.round(s.reserveSoc * 100)
  pct.maxSoc = Math.round(s.maxSoc * 100)
  pct.roundTripEfficiency = Math.round(s.roundTripEfficiency * 100)
}

// Keyboard steps on a slider fire one change each: wait for a pause before saving
let strategyTimer: ReturnType<typeof setTimeout>
function saveStrategySoon() {
  clearTimeout(strategyTimer)
  strategyTimer = setTimeout(saveStrategy, 400)
}
async function saveStrategy() {
  try {
    // The server clamps out-of-range values; show what it kept
    setStrategy(await api('/api/strategy', {
      method: 'PUT',
      body: { ...strategy.value, reserveSoc: pct.reserveSoc / 100, maxSoc: pct.maxSoc / 100, roundTripEfficiency: pct.roundTripEfficiency / 100 },
    }))
    strategyMsg.value = { ok: true, text: m.value.settings.strategySaved }
  } catch (e: any) {
    strategyMsg.value = { ok: false, text: whyNot(e) }
  }
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
    results.solaredge = se === 'ok' ? { ok: true, text: m.value.settings.connected } : { ok: false, text: se }
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
.lang-tile { font-size: 12px; font-weight: 700; letter-spacing: 0.02em; color: var(--text); }
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
/* A row with help text gives the words the room and keeps the value narrow */
.stack-text + .unit-in, .stack-text + input { width: auto; flex: none; }
.stack-text + .unit-in input { width: 7ch; }
.list-row > .stack-text { flex: 1 1 auto; }
.row-btn:disabled { opacity: 0.6; }
.copy { user-select: all; word-break: break-all; }
.foot { font-size: 13px; color: var(--text-2); margin: -4px 2px 0; max-width: 60ch; }
.wide { width: 100%; margin-top: 4px; padding: 13px; }
.stack-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding-right: 12px; }
.list-row input.range { -webkit-appearance: none; appearance: none; height: 4px; padding: 0; border-radius: 2px; margin: 10px 0 6px; background: linear-gradient(90deg, var(--text) calc(var(--p) * 100%), var(--fill) 0); }
.range::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: var(--surface); border: 2px solid var(--text); }
.range::-moz-range-thumb { width: 18px; height: 18px; border: 2px solid var(--text); border-radius: 50%; background: var(--surface); }
.range:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--text); outline-offset: 2px; }
.list-row input.range:focus { box-shadow: none; }

/* Groups are spaced by a gap, not their margins, so the spacing is the same in one column and in two */
.groups { display: flex; flex-direction: column; gap: 28px; }
.col { display: contents; }
.group { order: var(--o); }
.group > .section-title:first-child { margin-top: 0; }
.group > :last-child { margin-bottom: 0; }
@media (min-width: 1024px) {
  .groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 56px; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 36px; }
  .group { order: 0; }
}
</style>
