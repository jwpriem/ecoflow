<template>
  <div class="onboarding">
    <p class="progress small muted" :aria-label="m.onboarding.progress(index + 1, ONBOARDING_STEPS.length)">
      <span v-for="(s, i) in ONBOARDING_STEPS" :key="s" class="pip" :class="{ on: i <= index }" />
      <span>{{ m.onboarding.progress(index + 1, ONBOARDING_STEPS.length) }}</span>
    </p>
    <h1>{{ t.title }}</h1>
    <p class="muted lede">{{ t.lede }}</p>

    <!-- 1 · The household's name -->
    <form v-if="step === 'household'" id="step" @submit.prevent="nameHousehold">
      <div class="list">
        <label class="list-row stack"><input v-model="name" :placeholder="m.onboarding.household.placeholder" :aria-label="m.onboarding.household.placeholder" maxlength="60" required /></label>
      </div>
    </form>

    <!-- 2 · Tibber: the token, the home, and the Pulse WattsWise needs -->
    <form v-else-if="step === 'tibber'" id="step" @submit.prevent="tibberOk ? next() : connect('tibber')">
      <div class="list">
        <label class="list-row stack">
          <span class="small muted">{{ m.settings.fields.token }}</span>
          <input v-model="forms.tibber.token" type="password" :placeholder="tibber?.configured ? m.settings.keepSaved : ''" autocomplete="off" />
        </label>
        <label v-if="homes.length > 1" class="list-row stack">
          <span class="small muted">{{ m.settings.home }}</span>
          <select v-model="homeId" @change="pickHome">
            <option v-for="h in homes" :key="h.id" :value="h.id">{{ h.name }}</option>
          </select>
        </label>
      </div>
      <p class="small guide"><NuxtLink :to="`/guides/tibber?from=/onboarding`">{{ m.guides.howTo }}</NuxtLink></p>
      <p v-if="tibber?.configured && tibber.status === 'ok' && !tibber.meta.realtime" class="note stop" role="alert">
        <strong>{{ m.onboarding.tibber.noPulseTitle }}</strong>
        {{ m.onboarding.tibber.noPulse }}
        <a href="https://tibber.com/nl/store/product/pulse" target="_blank" rel="noopener">{{ m.onboarding.tibber.getPulse }}</a>
      </p>
      <p v-else-if="tibberOk" class="pos small" role="status">{{ m.onboarding.tibber.found(homeName) }}</p>
    </form>

    <!-- 3 · EcoFlow: the developer keys; the batteries are found on the account -->
    <form v-else-if="step === 'ecoflow'" id="step" @submit.prevent="devs.length && !keysTyped ? next() : connect('ecoflow_official')">
      <div class="list">
        <label v-for="f in ['accessKey', 'secretKey']" :key="f" class="list-row stack">
          <span class="small muted">{{ m.settings.fields[f] }}</span>
          <input v-model="forms.ecoflow_official[f]" type="password" :placeholder="ecoflow?.configured ? m.settings.keepSaved : ''" autocomplete="off" />
        </label>
      </div>
      <p class="small guide"><NuxtLink :to="`/guides/ecoflow?from=/onboarding`">{{ m.guides.howTo }}</NuxtLink></p>
      <template v-if="devs.length">
        <h3 class="section-title">{{ m.onboarding.ecoflow.found(devs.length) }}</h3>
        <div class="list">
          <div v-for="d in devs" :key="d.id" class="list-row">
            <span class="title">{{ d.name || m.settings.battery }}</span>
            <span class="detail small muted">{{ (d.capacityWh / 1000).toLocaleString(m.dateLocale, { maximumFractionDigits: 2 }) }} kWh</span>
          </div>
        </div>
      </template>
      <p v-else-if="ecoflow?.configured && ecoflow.status === 'ok'" class="note small">{{ m.onboarding.ecoflow.none }}</p>
    </form>

    <!-- 4 · SolarEdge, optional: client ID and secret, then the sign-in at SolarEdge -->
    <form v-else-if="step === 'solaredge'" id="step" @submit.prevent="solarOk && !keysTyped ? next() : solaredge?.configured && !keysTyped ? signInSolarEdge() : connect('solaredge')">
      <div class="list">
        <label v-for="f in ['clientId', 'clientSecret']" :key="f" class="list-row stack">
          <span class="small muted">{{ m.settings.fields[f] }}</span>
          <input v-model="forms.solaredge[f]" :type="f === 'clientSecret' ? 'password' : 'text'" :placeholder="solaredge?.configured ? m.settings.keepSaved : ''" autocomplete="off" />
        </label>
      </div>
      <p v-if="solaredge?.redirectUri" class="small muted">{{ m.settings.redirectUri }} <code>{{ solaredge.redirectUri }}</code></p>
      <p class="small guide"><NuxtLink :to="`/guides/solaredge?from=/onboarding`">{{ m.guides.howTo }}</NuxtLink></p>
      <p v-if="solarOk" class="pos small" role="status">{{ m.onboarding.solaredge.connected }}</p>
    </form>

    <!-- 5 · What WattsWise found and assumes: the batteries, the reserve and the feed-in terms -->
    <form v-else-if="step === 'battery' && strategy" id="step" @submit.prevent="saveBattery">
      <template v-for="d in devs" :key="d.id">
        <h3 class="section-title">{{ d.name || m.settings.battery }}</h3>
        <div class="list">
          <label class="list-row"><span class="title">{{ m.settings.capacity }}</span><span class="unit-in"><input v-model.number="d.capacityWh" type="number" inputmode="numeric" /> Wh</span></label>
          <label class="list-row"><span class="title">{{ m.settings.maxCharge }}</span><span class="unit-in"><input v-model.number="d.maxChargeW" type="number" inputmode="numeric" /> W</span></label>
          <label class="list-row"><span class="title">{{ m.settings.maxDischarge }}</span><span class="unit-in"><input v-model.number="d.maxDischargeW" type="number" inputmode="numeric" /> W</span></label>
        </div>
      </template>
      <h3 class="section-title">{{ m.settings.strategy }}</h3>
      <div class="list">
        <div class="list-row stack">
          <div class="spread"><span class="title">{{ m.settings.reserve }}</span><span class="detail">{{ reserve }}%</span></div>
          <input v-model.number="reserve" type="range" min="0" max="90" step="5" class="range" :style="{ '--p': reserve / 90 }" :aria-label="m.settings.reserve" />
          <span class="small muted">{{ m.settings.help.reserve }}</span>
        </div>
      </div>
      <h3 class="section-title">{{ m.settings.feedIn }}</h3>
      <div class="list">
        <label class="list-row">
          <span class="stack-text"><span class="title">{{ m.settings.nettingUntil }}</span><span class="small muted">{{ m.settings.help.nettingUntil }}</span></span>
          <input v-model="strategy.feedIn.nettingUntil" type="date" />
        </label>
        <label class="list-row">
          <span class="stack-text"><span class="title">{{ m.settings.afterFactor }}</span><span class="small muted">{{ m.settings.help.afterFactor }}</span></span>
          <span class="unit-in">× <input v-model.number="strategy.feedIn.factor" type="number" step="0.01" inputmode="decimal" /></span>
        </label>
        <label class="list-row">
          <span class="stack-text"><span class="title">{{ m.settings.fee }}</span><span class="small muted">{{ m.settings.help.fee }}</span></span>
          <span class="unit-in">€ <input v-model.number="strategy.feedIn.feeEur" type="number" step="0.001" inputmode="decimal" /> /kWh</span>
        </label>
      </div>
      <h3 class="section-title">{{ m.location.section }}</h3>
      <SolarLocation />
      <p class="small muted">{{ m.onboarding.battery.later }}</p>
    </form>

    <!-- 6 · Monitor only, or let WattsWise steer (through the steering disclaimer) -->
    <form v-else-if="step === 'control'" id="step" @submit.prevent="finish">
      <div class="list" role="radiogroup" :aria-label="m.settings.whoSteers">
        <button v-for="o in (['monitor', 'wattwise'] as const)" :key="o" type="button" role="radio" class="list-row row-btn" :aria-checked="choice === o" @click="choice = o">
          <span class="stack-text"><span class="title">{{ m.settings.control[o].label }}</span><span class="small muted">{{ m.settings.control[o].help }}</span></span>
          <AppIcon v-if="choice === o" name="check" class="check" />
        </button>
      </div>
      <p class="small muted">{{ m.onboarding.control.later }}</p>
      <SteeringConsent ref="consent" />
    </form>

    <p v-if="msg" :class="msg.ok ? 'pos' : 'error'" role="status">{{ msg.text }}</p>
    <div class="actions">
      <button v-if="index > 0" type="button" class="plain" :disabled="busy" @click="back">{{ m.onboarding.back }}</button>
      <span class="gap" />
      <button v-if="step === 'solaredge' && !solarOk" type="button" :disabled="busy" @click="next">{{ m.onboarding.skip }}</button>
      <button type="submit" form="step" class="primary" :disabled="busy || !canSubmit">{{ busy ? m.onboarding.busy : primaryLabel }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ONBOARDING_STEPS, type OnboardingStep } from '#shared/onboarding'

/**
 * A new household's owner: name, Tibber with a Pulse, the EcoFlow batteries, SolarEdge (optional), the battery
 * settings and feed-in terms, then monitor or steer. The step lives on the server, so a reload resumes it.
 */
const api = useApi()
const route = useRoute()
const { me, loadMe } = useAuth()
const { m, serverText } = useLocale()

const step = computed<OnboardingStep>(() => me.value?.onboarding ?? 'household')
const index = computed(() => ONBOARDING_STEPS.indexOf(step.value))
const t = computed(() => m.value.onboarding[step.value])
const busy = ref(false)
const msg = ref<{ ok: boolean; text: string } | null>(null)
const fail = (e: any) => (msg.value = { ok: false, text: serverText(e?.data?.statusMessage) || e?.message || m.value.common.failed })

const name = ref('')
const integrations = ref<any[]>([])
const devs = ref<any[]>([])
const strategy = ref<any>(null)
const reserve = ref(10)
type Keys = Record<string, string>
const forms = reactive<{ tibber: Keys; ecoflow_official: Keys; solaredge: Keys }>({ tibber: {}, ecoflow_official: {}, solaredge: {} })
const homeId = ref('')
const choice = ref<'monitor' | 'wattwise'>('monitor')
const consent = ref<{ ask: (version: string) => Promise<boolean> } | null>(null)

const of = (p: string) => integrations.value.find((i) => i.provider === p)
const tibber = computed(() => of('tibber'))
const ecoflow = computed(() => of('ecoflow_official'))
const solaredge = computed(() => of('solaredge'))
const homes = computed<{ id: string; name: string }[]>(() => (tibber.value?.meta.homes as any[]) ?? [])
const homeName = computed(() => homes.value.find((h) => h.id === tibber.value?.meta.homeId)?.name ?? '')
const tibberOk = computed(() => tibber.value?.status === 'ok' && !!tibber.value.meta.realtime && !forms.tibber.token)
const solarOk = computed(() => !!solaredge.value?.meta.authorized)
// New keys typed in replace the saved ones: the button connects again instead of moving on
const keysTyped = computed(() => Object.values(forms[step.value === 'ecoflow' ? 'ecoflow_official' : 'solaredge']).some(Boolean))

const canSubmit = computed(() => {
  if (step.value === 'household') return !!name.value.trim()
  if (step.value === 'tibber') return tibberOk.value || !!forms.tibber.token || !!tibber.value?.configured
  if (step.value === 'ecoflow') return (!!devs.value.length && !keysTyped.value) || (!!forms.ecoflow_official.accessKey && !!forms.ecoflow_official.secretKey)
  if (step.value === 'solaredge') return solarOk.value || !!solaredge.value?.configured || (!!forms.solaredge.clientId && !!forms.solaredge.clientSecret)
  return true
})
const primaryLabel = computed(() => {
  const o = m.value.onboarding
  if (step.value === 'tibber' && !tibberOk.value) return o.connect
  if (step.value === 'ecoflow' && (!devs.value.length || keysTyped.value)) return o.connect
  if (step.value === 'solaredge' && !solarOk.value) return solaredge.value?.configured && !keysTyped.value ? m.value.settings.signIn : o.connect
  if (step.value === 'control') return o.finish
  return o.next
})

async function load() {
  integrations.value = await api('/api/integrations')
  devs.value = await api('/api/devices')
  homeId.value = (tibber.value?.meta.homeId as string) ?? ''
  if (step.value === 'battery' || step.value === 'control') {
    const plan: any = await api('/api/plan')
    strategy.value = plan.strategy
    reserve.value = Math.round(plan.strategy.reserveSoc * 100)
    choice.value = plan.controlMode === 'auto' && plan.steering !== 'ecoflow_ai' ? 'wattwise' : 'monitor'
  }
}

async function go(to: OnboardingStep | 'done') {
  await api('/api/onboarding', { method: 'PUT', body: { step: to } })
  await loadMe(true)
  msg.value = null
  if (to !== 'done') await load()
}

async function run(work: () => Promise<unknown>) {
  busy.value = true
  msg.value = null
  try {
    await work()
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
  }
}

const next = () => run(() => go(ONBOARDING_STEPS[index.value + 1] ?? 'done'))
const back = () => run(() => go(ONBOARDING_STEPS[index.value - 1]!))

const nameHousehold = () =>
  run(async () => {
    await api('/api/household', { method: 'PUT', body: { name: name.value } })
    await go('tibber')
  })

/** Save and test the keys typed in (or, without any, test the saved ones again) */
const connect = (provider: 'tibber' | 'ecoflow_official' | 'solaredge') =>
  run(async () => {
    const f = forms[provider]
    const filled = Object.values(f).some(Boolean)
    const r: any = await api(`/api/integrations/${provider}`, { method: 'PUT', body: { ...(filled ? { credentials: f } : {}), meta: {} } })
    forms[provider] = {}
    await load()
    if (!r.ok) throw new Error(r.error ?? m.value.settings.testFailed)
    // SolarEdge: the keys are saved, the sign-in at SolarEdge comes next
    if (provider === 'solaredge') await startSolarEdge()
  })

const pickHome = () =>
  run(async () => {
    const r: any = await api('/api/integrations/tibber', { method: 'PUT', body: { meta: { homeId: homeId.value } } })
    await load()
    if (!r.ok) throw new Error(r.error ?? m.value.settings.testFailed)
  })

async function startSolarEdge() {
  const { url } = await api<{ url: string }>('/api/integrations/solaredge/authorize')
  window.location.href = url
}
const signInSolarEdge = () => run(startSolarEdge)

const saveBattery = () =>
  run(async () => {
    for (const d of devs.value) {
      await api(`/api/devices/${d.id}`, { method: 'PUT', body: { capacityWh: d.capacityWh, maxChargeW: d.maxChargeW, maxDischargeW: d.maxDischargeW } })
    }
    await api('/api/strategy', { method: 'PUT', body: { ...strategy.value, reserveSoc: reserve.value / 100 } })
    await go('control')
  })

/** Steering on goes through the steering disclaimer (409 with data.consent), as in Settings */
async function withConsent(call: () => Promise<unknown>) {
  try {
    return await call()
  } catch (e: any) {
    const c = e?.data?.data
    if (e?.statusCode !== 409 || c?.consent !== 'steering') throw e
    if (!(await consent.value?.ask(c.version))) throw new Error(m.value.consent.declined)
    return call()
  }
}

const finish = () =>
  run(async () => {
    const plan: any = await api('/api/plan')
    if (choice.value === 'wattwise') {
      if (plan.steering === 'ecoflow_ai') await api('/api/ecoflow/steering', { method: 'PUT', body: { steering: 'wattwise' } })
      if (plan.controlMode !== 'auto') await withConsent(() => api('/api/plan/override', { method: 'POST', body: { controlMode: 'auto' } }))
    } else if (plan.controlMode !== 'manual') {
      await api('/api/plan/override', { method: 'POST', body: { controlMode: 'manual' } })
    }
    await go('done')
    await navigateTo('/app')
  })

onMounted(async () => {
  await loadMe(true).catch(() => undefined)
  if (!me.value?.onboarding) return navigateTo('/app')
  name.value = me.value.site.name
  await load().catch(fail)
  // Back from the SolarEdge sign-in
  const se = route.query.solaredge
  if (typeof se === 'string') msg.value = se === 'ok' ? { ok: true, text: m.value.onboarding.solaredge.connected } : { ok: false, text: serverText(se) }
})
useHead({ title: () => `${m.value.onboarding.welcome} · WattsWise` })
</script>

<style scoped>
.onboarding { max-width: 480px; margin: 6vh auto 48px; }
.progress { display: flex; align-items: center; gap: 6px; margin: 0 0 20px; }
.pip { width: 22px; height: 4px; border-radius: 2px; background: var(--separator); }
.pip.on { background: var(--text); }
.progress span:last-child { margin-left: 6px; }
h1 { margin: 0 0 8px; font-size: 28px; font-stretch: 125%; letter-spacing: -0.02em; }
.lede { font-size: 15px; margin: 0 0 24px; }
.list-row.stack { padding: 8px 16px; gap: 2px; }
.list-row.stack input, .list-row.stack select { border: 0; padding: 6px 0; border-radius: 0; background: transparent; }
.unit-in { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.unit-in input { width: 90px; text-align: right; }
.row-btn { width: 100%; text-align: left; border: 0; border-radius: 0; background: transparent; }
.stack-text { display: flex; flex-direction: column; gap: 2px; }
.check { color: var(--sys-blue); flex: none; }
.guide { margin: 10px 0 0; }
.guide a { color: var(--sys-blue); }
.stop { margin-top: 16px; line-height: 1.5; }
.stop strong { display: block; }
.stop a { color: var(--sys-blue); }
code { font-size: 12px; word-break: break-all; }
.section-title { margin-top: 24px; }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 28px; }
.actions .gap { flex: 1; }
.actions .primary { padding: 12px 22px; font-size: 16px; }
.pos, .error { margin: 16px 0 0; }
</style>
