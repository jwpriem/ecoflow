<template>
  <!-- The Midea air conditioners: how each is set, and the controls. Every change is sent straight away. -->
  <section class="group">
    <p v-if="loading && !aircos" class="foot">{{ m.settings.airco.loading }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="aircos && !aircos.length" class="foot">{{ m.settings.airco.none }}</p>
    <div v-for="a in aircos ?? []" :key="a.id" class="airco">
      <div class="head">
        <h3 class="section-title">{{ a.name }}</h3>
        <span v-if="a.state" class="temps small muted">
          {{ m.settings.airco.indoor }} {{ deg(a.state.indoorC) }} · {{ m.settings.airco.outdoor }} {{ deg(a.state.outdoorC) }}
        </span>
      </div>
      <p v-if="!a.online" class="small muted">{{ m.settings.airco.offline }}</p>
      <p v-if="!a.state" class="error">{{ m.settings.airco.noStatus(a.error ?? '') }}</p>
      <template v-else>
        <!-- A round power button: lit when the unit is on -->
        <div class="field-row">
          <span class="title">{{ a.state.running ? m.settings.airco.on : m.settings.airco.off }}</span>
          <button
            type="button" class="power" :class="{ on: a.state.running }" :aria-pressed="a.state.running" :aria-label="m.settings.airco.power"
            :disabled="busy === a.id" @click="change(a, { running: !a.state.running })"
          >
            <AppIcon name="power" />
          </button>
        </div>
        <!-- Five modes don't fit side by side on a phone: a list, like the fan -->
        <label class="field">
          <span class="field-label">{{ m.settings.airco.mode }}</span>
          <select :value="a.state.mode ?? 'auto'" :disabled="busy === a.id" @change="change(a, { mode: ($event.target as HTMLSelectElement).value as Mode })">
            <option v-for="o in modeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <div class="field-row">
          <span class="title">{{ m.settings.airco.target }}</span>
          <span class="stepper">
            <button type="button" :disabled="busy === a.id || a.state.targetC <= MIN_C" :aria-label="`${m.settings.airco.target} −`" @click="change(a, { targetC: a.state.targetC - 0.5 })">−</button>
            <span class="value">{{ deg(a.state.targetC) }}</span>
            <button type="button" :disabled="busy === a.id || a.state.targetC >= MAX_C" :aria-label="`${m.settings.airco.target} +`" @click="change(a, { targetC: a.state.targetC + 0.5 })">+</button>
          </span>
        </div>
        <label class="field">
          <span class="field-label">{{ m.settings.airco.fan }}</span>
          <select :value="fanValue(a.state.fanSpeed)" :disabled="busy === a.id" @change="change(a, { fanSpeed: Number(($event.target as HTMLSelectElement).value) })">
            <option v-if="!FANS.includes(fanValue(a.state.fanSpeed))" :value="a.state.fanSpeed">{{ a.state.fanSpeed }}%</option>
            <option v-for="f in FANS" :key="f" :value="f">{{ m.settings.airco.fans[f] }}</option>
          </select>
        </label>
        <p v-if="a.state.errorCode" class="error">{{ m.settings.airco.unitError(a.state.errorCode) }}</p>
        <p class="small muted">{{ busy === a.id ? m.settings.airco.sending : a.readAt ? m.settings.airco.read(time(a.readAt)) : '' }}</p>
      </template>
      <div class="history">
        <div class="history-head">
          <span class="field-label">{{ m.settings.airco.history }}</span>
          <Segmented :options="rangeOptions" :model-value="hours" @update:model-value="setHours" />
        </div>
        <AircoChart :points="history[a.id] ?? []" :hours="hours" :label="`${m.settings.airco.history} ${a.name}`" :empty-text="m.settings.airco.historyEmpty" />
        <div class="legend small muted">
          <span><i class="key indoor" />{{ m.settings.airco.indoor }}</span>
          <span><i class="key outdoor" />{{ m.settings.airco.outdoor }}</span>
          <span><i class="key target" />{{ m.settings.airco.targetLegend }}</span>
        </div>
      </div>
    </div>
    <button v-if="aircos" type="button" class="plain small" :disabled="loading" @click="load(true)">{{ m.settings.airco.refresh }}</button>
    <p class="foot">{{ m.settings.airco.foot }}</p>
  </section>
</template>

<script setup lang="ts">
type Mode = 'auto' | 'cool' | 'dry' | 'heat' | 'fan'
interface AcState { running: boolean; mode: Mode | null; targetC: number; fanSpeed: number; indoorC: number | null; outdoorC: number | null; errorCode: number }
interface Airco { id: string; name: string; online: boolean; state: AcState | null; error?: string; readAt: string | null }
interface Point { ts: string; running: boolean; targetC: number | null; indoorC: number | null; outdoorC: number | null }
type Change = Partial<Pick<AcState, 'running' | 'targetC' | 'fanSpeed'>> & { mode?: Mode }

const MIN_C = 16
const MAX_C = 30
/** The fan speeds the Midea app offers; 102 is auto */
const FANS = [20, 40, 60, 80, 100, 102]

const { m, serverText } = useLocale()
const api = useApi()
const aircos = ref<Airco[] | null>(null)
const loading = ref(false)
const busy = ref('')
const error = ref('')
// The temperature chart: the last day or week, from the readings every 5 minutes
const hours = ref(24)
const history = ref<Record<string, Point[]>>({})
const rangeOptions = computed(() => [
  { value: 24, label: m.value.settings.airco.day },
  { value: 168, label: m.value.settings.airco.week },
])

async function loadHistory() {
  try {
    history.value = (await api<{ aircos: Record<string, Point[]> }>(`/api/airco/history?hours=${hours.value}`)).aircos
  } catch {
    // The chart just stays empty; the controls above still work
  }
}

function setHours(h: number) {
  hours.value = h
  loadHistory()
}

const modeOptions = computed(() => (['auto', 'cool', 'dry', 'heat', 'fan'] as const).map((v) => ({ value: v, label: m.value.settings.airco.modes[v]! })))
const deg = (c: number | null | undefined) => (c == null ? '–' : `${c.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} °C`)
/** Some units report a speed near a preset (e.g. 101 for auto): show the preset */
const fanValue = (f: number) => (f > 100 ? 102 : f)

async function load(fresh = false) {
  loading.value = true
  error.value = ''
  try {
    const r = await api<{ aircos: Airco[] }>(`/api/airco${fresh ? '?fresh=1' : ''}`)
    aircos.value = r.aircos
    await loadHistory()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || e?.message || m.value.common.failed
  } finally {
    loading.value = false
  }
}

async function change(a: Airco, body: Change) {
  if (busy.value) return
  busy.value = a.id
  error.value = ''
  try {
    const r = await api<{ airco: Airco }>(`/api/airco/${a.id}`, { method: 'PUT', body })
    aircos.value = (aircos.value ?? []).map((x) => (x.id === a.id ? r.airco : x))
    haptic('success')
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || e?.message || m.value.common.failed
    haptic('error')
  } finally {
    busy.value = ''
  }
}

onMounted(() => load())
</script>

<style scoped>
.airco { display: flex; flex-direction: column; gap: 4px; background: var(--surface); border-radius: var(--radius); padding: 14px 16px 16px; margin-bottom: 12px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head .section-title { margin: 0 0 8px; }
.field-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.field { margin-bottom: 12px; }
.field-label { display: block; font-size: 14px; color: var(--text-2); margin: 0 2px 6px; }
.power { width: 56px; height: 56px; padding: 0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; flex: none; background: transparent; border: 1.5px solid var(--rule); color: var(--muted); transition: background-color var(--dur-2) var(--ease-out), border-color var(--dur-2), color var(--dur-2), box-shadow var(--dur-3); }
.power svg { width: 26px; height: 26px; stroke-width: 2.2; }
.power.on { background: var(--cta); border-color: var(--cta); color: #fff; box-shadow: 0 0 0 4px color-mix(in srgb, var(--cta) 22%, transparent); }
.power:disabled { opacity: 0.6; }
.stepper { display: inline-flex; align-items: center; gap: 10px; }
.stepper button { width: 36px; height: 36px; padding: 0; border-radius: 50%; font-size: 18px; line-height: 1; }
.stepper .value { min-width: 7ch; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }
.airco p { margin: 4px 0 0; }
.history { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--rule); }
.history-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.history-head .field-label { margin: 0; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.key { display: inline-block; width: 14px; height: 0; border-top: 2px solid; }
.key.indoor { border-color: var(--text); }
.key.outdoor { border-color: var(--sys-blue); }
.key.target { border-top-style: dashed; border-color: var(--cta); }
.foot { font-size: 13px; color: var(--text-2); margin: 8px 2px 0; max-width: 60ch; }
</style>
