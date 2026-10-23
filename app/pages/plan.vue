<template>
  <div>
    <header class="page-head"><h1>Plan</h1></header>

    <template v-if="data">
      <p v-if="data.override" class="override">
        <span><strong>Override:</strong> {{ MODE_LABEL[data.override.mode] }} until {{ time(data.override.until) }}</span>
        <button class="plain" :disabled="busy" @click="endOverride">End override</button>
      </p>
      <p v-if="data.steering === 'ecoflow_ai'" class="note">EcoFlow AI steers the batteries. This plan is only shown.</p>
      <p v-else-if="data.controlMode === 'manual'" class="note">Monitoring only: this plan isn't sent to the batteries.</p>

      <!-- No prices: nothing to plan with -->
      <section v-if="!data.slots.length" class="no-prices">
        <h2>No prices yet</h2>
        <p>WattWise plans from Tibber's 15-minute prices. Add your Tibber token in Settings: today's prices and the plan appear within a minute, tomorrow's around 13:00.</p>
        <NuxtLink to="/settings">Open Settings</NuxtLink>
      </section>

      <template v-else>
      <!-- Readout for the selected quarter; it starts on now -->
      <section class="readout" aria-live="polite">
        <template v-if="picked">
          <h2 class="r-act"><i class="sw" :style="{ background: colorOf(picked.action) }" />{{ picked.action ? MODE_LABEL[picked.action] : 'No plan' }}</h2>
          <p class="r-line">
            <span class="r-when">{{ isNow ? 'Now' : dayLabel(picked.slotStart) }}, {{ time(picked.slotStart) }}–{{ time(slotEnd(picked.slotStart)) }}</span>
            <span class="r-price">{{ cents(picked.total) }} per kWh</span>
            <span v-if="picked.solarW >= 10" class="r-sun">{{ Math.round(picked.solarW) }} W solar expected</span>
          </p>
          <p v-if="picked.reason" class="r-reason">{{ picked.reason }}</p>
          <button v-if="!isNow && nowIndex >= 0" class="plain r-back" @click="selected = nowIndex">Back to now</button>
        </template>
      </section>

      <PriceChart v-model="selected" :slots="data.slots" :now="now" />
      <ul class="legend">
        <li v-for="a in actions" :key="a.value"><i class="sw" :style="{ background: a.color }" />{{ a.label }}</li>
      </ul>
      <p v-if="!hasTomorrow" class="hint">Tomorrow's prices come in around 13:00.</p>
      <p v-if="solarDays.length" class="hint">Expected solar (Open-Meteo): {{ solarDays.map((d) => `${d.label.toLowerCase()} ${d.kwh.toFixed(1)} kWh`).join(', ') }}.</p>

      <section class="block">
        <div class="block-head"><h2>Coming up</h2></div>
        <template v-for="g in shownGroups" :key="g.day">
          <h3 class="block-sub">{{ g.day }}</h3>
          <ol class="runs">
            <li v-for="r in g.runs" :key="r.start" :class="{ current: r.current }">
              <button type="button" class="run" @click="selected = r.index">
                <i class="sw" :style="{ background: colorOf(r.action) }" />
                <span class="run-time">{{ time(r.start) }}–{{ time(r.end) }}</span>
                <span class="run-act">{{ MODE_LABEL[r.action] ?? '–' }}<em v-if="r.current">now</em></span>
                <span class="run-price">{{ Math.round(r.min * 100) }}<template v-if="Math.round(r.max * 100) !== Math.round(r.min * 100)">–{{ Math.round(r.max * 100) }}</template> ct</span>
                <span v-if="r.reason" class="run-reason">{{ r.reason }}</span>
              </button>
            </li>
          </ol>
        </template>
        <button v-if="hiddenRuns > 0" class="plain more" @click="allRuns = true">Show {{ hiddenRuns }} more</button>
      </section>
      </template>

      <section class="block">
        <div class="block-head"><h2>Who steers the batteries</h2></div>
        <template v-if="data.steering">
          <Segmented
            :model-value="data.steering"
            :options="[{ value: 'ecoflow_ai', label: 'EcoFlow AI' }, { value: 'wattwise', label: 'WattWise' }]"
            full
            @update:model-value="(v) => setSteering(v)"
          />
          <p class="hint">
            <span v-if="steeringError" class="error">{{ steeringError }}</span>
            <template v-else-if="data.steering === 'ecoflow_ai'">EcoFlow's AI mode decides when to charge. WattWise only plans.</template>
            <template v-else>WattWise applies each plan step through the backup reserve, in Self-Powered mode.</template>
          </p>
        </template>
        <template v-if="data.steering !== 'ecoflow_ai'">
          <Segmented
            class="mode"
            :model-value="data.controlMode"
            :options="[{ value: 'auto', label: 'Follow the plan' }, { value: 'manual', label: 'Monitor only' }]"
            full
            @update:model-value="(v) => send({ controlMode: v }, v === 'auto' ? 'Following the plan again.' : 'Monitoring only. The plan is no longer sent.')"
          />
          <p class="hint">{{ data.controlMode === 'auto' ? 'The batteries get the plan every 15 minutes.' : 'The batteries run on their own. The plan is only shown.' }}</p>
        </template>
      </section>

      <section class="block">
        <div class="block-head"><h2>Override the plan</h2></div>
        <div class="choices" role="radiogroup" aria-label="Mode">
          <label v-for="a in actions" :key="a.value" class="choice">
            <input v-model="overrideMode" type="radio" name="override-mode" :value="a.value" />
            <i class="sw" :style="{ background: a.color }" />
            <span class="c-label">{{ a.label }}</span>
            <span class="c-help">{{ a.help }}</span>
          </label>
        </div>
        <div class="o-foot">
          <Segmented v-model="minutes" :options="durations" aria-label="Duration" />
          <button class="primary" :disabled="busy || !overrideMode" @click="startOverride">{{ overrideMode ? `${actionLabel(overrideMode)} for ${durationLabel}` : 'Choose a mode' }}</button>
        </div>
      </section>

      <details class="block disclosure">
        <summary>Commands sent <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Battery</th><th>Mode</th><th>Source</th><th>Result</th></tr></thead>
            <tbody>
              <tr v-for="c in data.commands" :key="c.id">
                <td>{{ dayLabel(c.ts) === 'Today' ? '' : `${dayLabel(c.ts)} ` }}{{ time(c.ts) }}</td>
                <td>#{{ c.deviceId }}</td>
                <td>{{ MODE_LABEL[c.command] }}</td>
                <td>{{ c.payload.source }}</td>
                <td>{{ c.result }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!data.commands?.length" class="hint">Nothing sent yet.</p>
        </div>
      </details>

      <Transition name="toast"><p v-if="message" class="toast" role="status">{{ message }}</p></Transition>
    </template>
    <LoadError v-else-if="error" :error="error" what="the plan" :busy="busy" @retry="retry" />
    <div v-else class="skeleton" style="height: 320px" />
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const data = ref<any>(null)
const error = ref<any>(null)
const minutes = ref(60)
const overrideMode = ref<string | null>(null)
const message = ref('')
const busy = ref(false)
const now = ref(Date.now())
const selected = ref(-1)

const SLOT = 15 * 60_000
const durations = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
  { value: 240, label: '4 h' },
] as const
const actions = [
  { value: 'charge_grid', label: 'Charge from grid', help: 'Buy power now and store it', color: 'var(--cheap)' },
  { value: 'discharge', label: 'Discharge', help: 'Run the house from the batteries', color: 'var(--dear)' },
  { value: 'self_use', label: 'Self-use', help: 'Store solar, cover the house', color: 'var(--own)' },
  { value: 'solar_only', label: 'Hold', help: 'Keep the charge, store only solar', color: 'var(--hold)' },
] as const
const colorOf = (a: string | null) => actions.find((x) => x.value === a)?.color ?? 'var(--fill)'
const actionLabel = (a: string) => actions.find((x) => x.value === a)?.label ?? a
const durationLabel = computed(() => durations.find((d) => d.value === minutes.value)?.label ?? `${minutes.value} min`)
const cents = (p: number) => `${(p * 100).toFixed(1).replace('.', ',')} ct`
const slotEnd = (s: string) => new Date(new Date(s).getTime() + SLOT)

function dayLabel(d: string | Date) {
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const today = new Date(now.value)
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : day.toLocaleDateString('en-GB', { weekday: 'long' })
}

const nowIndex = computed(() => (data.value?.slots ?? []).findIndex((s: any) => {
  const t = new Date(s.slotStart).getTime()
  return now.value >= t && now.value < t + SLOT
}))
const picked = computed(() => data.value?.slots[selected.value] ?? null)
const isNow = computed(() => selected.value === nowIndex.value)
// Expected production per day over the slots shown (15-min W values -> kWh)
const solarDays = computed(() => {
  const days = new Map<string, number>()
  for (const s of data.value?.slots ?? []) if (s.solarW) days.set(dayLabel(s.slotStart), (days.get(dayLabel(s.slotStart)) ?? 0) + s.solarW / 4000)
  return [...days].map(([label, kwh]) => ({ label, kwh }))
})
const hasTomorrow = computed(() => (data.value?.slots ?? []).some((s: any) => dayLabel(s.slotStart) === 'Tomorrow'))

// From the current quarter on, consecutive slots with the same action and reason become one run
const runGroups = computed(() => {
  const slots: any[] = data.value?.slots ?? []
  const from = Math.max(0, nowIndex.value)
  const runs: { start: string; end: Date; action: string; reason: string; min: number; max: number; index: number; current: boolean }[] = []
  for (let i = from; i < slots.length; i++) {
    const s = slots[i]
    if (!s.action) continue
    const last = runs[runs.length - 1]
    const sameDay = last && dayLabel(last.start) === dayLabel(s.slotStart)
    if (last && sameDay && last.action === s.action && last.reason === (s.reason ?? '') && last.end.getTime() === new Date(s.slotStart).getTime()) {
      last.end = slotEnd(s.slotStart)
      last.min = Math.min(last.min, s.total)
      last.max = Math.max(last.max, s.total)
    } else runs.push({ start: s.slotStart, end: slotEnd(s.slotStart), action: s.action, reason: s.reason ?? '', min: s.total, max: s.total, index: i, current: i === nowIndex.value })
  }
  const groups: { day: string; runs: typeof runs }[] = []
  for (const r of runs) {
    const day = dayLabel(r.start)
    const g = groups.find((x) => x.day === day) ?? (groups.push({ day, runs: [] }), groups[groups.length - 1]!)
    g.runs.push(r)
  }
  return groups
})

// The next few runs first; the rest on request
const RUNS_SHOWN = 5
const allRuns = ref(false)
const shownGroups = computed(() => {
  if (allRuns.value) return runGroups.value
  let left = RUNS_SHOWN
  return runGroups.value
    .map((g) => {
      const runs = g.runs.slice(0, Math.max(0, left))
      left -= runs.length
      return { ...g, runs }
    })
    .filter((g) => g.runs.length)
})
const hiddenRuns = computed(() => runGroups.value.reduce((n, g) => n + g.runs.length, 0) - shownGroups.value.reduce((n, g) => n + g.runs.length, 0))

async function load() {
  try {
    data.value = await api('/api/plan')
    now.value = Date.now()
    if (selected.value < 0 || selected.value >= data.value.slots.length) selected.value = nowIndex.value
    error.value = null
  } catch (e) {
    // Keep showing the last plan if a refresh fails; the error block is for a first load that fails
    if (!data.value) error.value = e
  }
}

async function retry() {
  busy.value = true
  await load()
  busy.value = false
}

let toast: ReturnType<typeof setTimeout>
function say(text: string) {
  message.value = text
  clearTimeout(toast)
  toast = setTimeout(() => (message.value = ''), 4000)
}

const steeringError = ref('')
async function setSteering(steering: string) {
  steeringError.value = ''
  try {
    await api('/api/ecoflow/steering', { method: 'PUT', body: { steering } })
    await load()
    say(steering === 'wattwise' ? 'WattWise now steers the batteries.' : 'EcoFlow AI now steers the batteries.')
  } catch (e: any) {
    steeringError.value = e?.data?.statusMessage ?? e?.message ?? 'Switching failed. Try again in a minute.'
  }
}

async function send(body: Record<string, unknown>, done: string) {
  busy.value = true
  try {
    await api('/api/plan/override', { method: 'POST', body })
    await load()
    say(done)
  } catch (e: any) {
    say(e?.data?.statusMessage ?? 'The batteries didn\'t take the change. Try again.')
  } finally {
    busy.value = false
  }
}
function startOverride() {
  if (!overrideMode.value) return
  const until = new Date(Date.now() + minutes.value * 60_000)
  send({ mode: overrideMode.value, minutes: minutes.value }, `Override started: ${actionLabel(overrideMode.value)} until ${time(until)}.`)
  overrideMode.value = null
}
const endOverride = () => send({ clear: true }, 'Override ended. Back to the plan.')

let tick: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  // The now marker moves every minute; the plan itself refreshes every 5
  let n = 0
  tick = setInterval(() => {
    const wasNow = isNow.value
    now.value = Date.now()
    if (wasNow) selected.value = nowIndex.value
    if (++n % 5 === 0) load()
  }, 60_000)
})
onBeforeUnmount(() => clearInterval(tick))
</script>

<style scoped>
.override { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0 0 20px; padding: 10px 0 10px 12px; border-left: 3px solid var(--text); font-size: 15px; }
.override .plain { flex: none; }
.note { margin: 0 0 20px; }

.no-prices { border-top: 1px solid var(--rule); padding-top: 18px; margin-bottom: 36px; }
.no-prices h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.no-prices p { margin: 0 0 14px; color: var(--text-2); max-width: 46ch; }
.no-prices a { font-weight: 600; }

.readout { min-height: 92px; margin-bottom: 14px; position: relative; }
.r-act { display: flex; align-items: center; gap: 10px; font-size: 28px; line-height: 1.1; font-weight: 700; font-stretch: 112%; letter-spacing: -0.01em; margin: 0 0 6px; }
.r-act .sw { width: 14px; height: 14px; border-radius: 3px; }
.r-line { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 0; font-size: 16px; font-variant-numeric: tabular-nums; }
.r-price { font-weight: 600; }
.r-sun { color: var(--sun); }
.r-reason { margin: 4px 0 0; font-size: 14px; color: var(--text-2); max-width: 52ch; }
.r-back { position: absolute; top: 2px; right: 0; font-size: 14px; }

.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 10px 0 0; padding: 0; font-size: 13px; color: var(--text-2); }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.legend + .hint { margin-top: 6px; }
.legend ~ .block { margin-top: 32px; }

.runs { list-style: none; margin: 0; padding: 0; }
.runs li + li { border-top: 1px solid var(--rule); }
.run {
  display: grid; grid-template-columns: 10px 96px 1fr auto; column-gap: 12px; align-items: baseline;
  width: 100%; padding: 11px 0; border: 0; border-radius: 0; background: none; text-align: left; font-weight: 400; font-size: 16px;
}
.run:hover { background: none; }
.run:hover .run-act { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--muted); }
.run .sw { align-self: center; }
.run-time, .run-price { font-variant-numeric: tabular-nums; font-stretch: 85%; color: var(--text-2); }
.run-price { font-size: 14px; }
.run-act em { font-style: normal; font-size: 12px; font-weight: 600; margin-left: 8px; padding: 1px 6px; border-radius: 3px; background: var(--text); color: var(--bg); vertical-align: 2px; }
.current .run-act { font-weight: 600; }
.run-reason { grid-column: 3 / -1; font-size: 13px; color: var(--text-2); margin-top: 2px; }

.mode { margin-top: 20px; }

.choices { display: grid; border-top: 1px solid var(--rule); }
.choice {
  display: grid; grid-template-columns: 22px 10px 1fr; column-gap: 10px; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--rule); cursor: pointer;
}
.choice input {
  -webkit-appearance: none; appearance: none; width: 18px; height: 18px; margin: 0; padding: 0;
  border: 1.5px solid var(--text-2); border-radius: 50%; background: none; display: grid; place-content: center; cursor: pointer;
}
.choice input::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--text); transform: scale(0); transition: transform 0.15s var(--ease-out); }
.choice input:checked { border-color: var(--text); }
.choice input:checked::before { transform: scale(1); }
.choice input:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.choice:has(input:checked) { background: var(--fill-2); }
.more { margin-top: 8px; font-size: 14px; }
.c-label { font-weight: 600; }
.c-help { grid-column: 3; font-size: 13px; color: var(--text-2); }
.o-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }

.disclosure > summary { font-size: 16px; }

.toast {
  position: fixed; left: 50%; bottom: calc(76px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 30;
  width: max-content; max-width: calc(100% - 32px); margin: 0; padding: 10px 14px; border-radius: 6px;
  background: var(--text); color: var(--bg); font-size: 14px;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.25s var(--ease-out); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 6px); }

@media (max-width: 380px) {
  .run { grid-template-columns: 10px 84px 1fr auto; }
}
</style>
