<template>
  <div>
    <header class="page-head"><h1>{{ m.plan.title }}</h1></header>

    <template v-if="data">
      <p v-if="data.override" class="override">
        <span><strong>{{ m.plan.override }}</strong> {{ m.plan.until(m.mode[data.override.mode] ?? data.override.mode, time(data.override.until)) }}</span>
        <button class="plain" :disabled="busy" @click="endOverride">{{ m.plan.endOverride }}</button>
      </p>
      <p v-if="data.steering === 'ecoflow_ai'" class="note">{{ m.plan.aiSteers }} <NuxtLink to="/settings">{{ m.plan.changeInSettings }}</NuxtLink></p>
      <p v-else-if="data.controlMode === 'manual'" class="note">{{ m.plan.monitorOnly }} <NuxtLink to="/settings">{{ m.plan.changeInSettings }}</NuxtLink></p>

      <!-- No prices: nothing to plan with -->
      <section v-if="!data.slots.length" class="no-prices">
        <h2>{{ m.plan.noPrices }}</h2>
        <p>{{ m.plan.noPricesText }}</p>
        <NuxtLink to="/settings">{{ m.common.openSettings }}</NuxtLink>
      </section>

      <template v-else>
      <!-- Readout for the selected quarter; it starts on now -->
      <section class="readout" aria-live="polite">
        <template v-if="picked">
          <h2 class="r-act"><i class="sw" :style="{ background: colorOf(picked.action) }" />{{ picked.action ? m.mode[picked.action] : m.plan.noPlan }}</h2>
          <p class="r-line">
            <span class="r-when">{{ isNow ? m.common.now : dayLabel(picked.slotStart) }}, {{ time(picked.slotStart) }}–{{ time(slotEnd(picked.slotStart)) }}</span>
            <span class="r-price">{{ cents(picked.total) }} {{ m.common.perKwh }}</span>
            <span v-if="picked.solarW >= 10" class="r-sun">{{ m.plan.solarExpected(Math.round(picked.solarW)) }}</span>
          </p>
          <p v-if="picked.reason" class="r-reason">{{ reason(picked.reason) }}</p>
          <button v-if="!isNow && nowIndex >= 0" class="plain r-back" @click="selected = nowIndex">{{ m.plan.backToNow }}</button>
        </template>
      </section>

      <PriceChart v-model="selected" :slots="data.slots" :now="now" />
      <ul class="legend">
        <li v-for="a in actions" :key="a.value"><i class="sw" :style="{ background: a.color }" />{{ m.mode[a.value] }}</li>
      </ul>
      <p v-if="!hasTomorrow" class="hint">{{ m.plan.tomorrowAt13 }}</p>
      <p v-if="solarDays.length" class="hint">{{ m.plan.expectedSolar(solarDays.map((d) => `${d.label.toLowerCase()} ${kwh(d.kwh, 1)}`).join(', ')) }}</p>

      <section class="block">
        <div class="block-head"><h2>{{ m.plan.comingUp }}</h2></div>
        <template v-for="g in shownGroups" :key="g.day">
          <h3 class="block-sub">{{ g.day }}</h3>
          <ol class="runs">
            <li v-for="r in g.runs" :key="r.start" :class="{ current: r.current }">
              <button type="button" class="run" @click="selected = r.index">
                <i class="sw" :style="{ background: colorOf(r.action) }" />
                <span class="run-time">{{ time(r.start) }}–{{ time(r.end) }}</span>
                <span class="run-act">{{ m.mode[r.action] ?? '–' }}<em v-if="r.current">{{ m.plan.nowTag }}</em></span>
                <span class="run-price">{{ Math.round(r.min * 100) }}<template v-if="Math.round(r.max * 100) !== Math.round(r.min * 100)">–{{ Math.round(r.max * 100) }}</template> ct</span>
                <span v-if="r.reason" class="run-reason">{{ reason(r.reason) }}</span>
              </button>
            </li>
          </ol>
        </template>
        <button v-if="hiddenRuns > 0" class="plain more" @click="allRuns = true">{{ m.plan.showMore(hiddenRuns) }}</button>
      </section>
      </template>

      <section class="block">
        <div class="block-head"><h2>{{ m.plan.overrideTitle }}</h2></div>
        <div class="choices" role="radiogroup" :aria-label="m.plan.modeAria">
          <label v-for="a in actions" :key="a.value" class="choice">
            <input v-model="overrideMode" type="radio" name="override-mode" :value="a.value" />
            <i class="sw" :style="{ background: a.color }" />
            <span class="c-label">{{ m.mode[a.value] }}</span>
            <span class="c-help">{{ m.modeHelp[a.value] }}</span>
          </label>
        </div>
        <div class="o-foot">
          <Segmented v-model="minutes" :options="durations" :aria-label="m.plan.durationAria" />
          <button class="primary" :disabled="busy || !overrideMode" @click="startOverride">{{ overrideMode ? m.plan.overrideFor(actionLabel(overrideMode), durationLabel) : m.plan.chooseMode }}</button>
        </div>
      </section>

      <details class="block disclosure">
        <summary>{{ m.plan.commandsSent }} <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ m.plan.cols.time }}</th><th>{{ m.plan.cols.battery }}</th><th>{{ m.plan.cols.mode }}</th><th>{{ m.plan.cols.source }}</th><th>{{ m.plan.cols.result }}</th></tr></thead>
            <tbody>
              <tr v-for="c in data.commands" :key="c.id">
                <td>{{ dayOffset(c.ts, now) === 0 ? '' : `${dayLabel(c.ts)} ` }}{{ time(c.ts) }}</td>
                <td>{{ deviceNames[c.deviceId] ?? `#${c.deviceId}` }}</td>
                <td>{{ m.mode[c.command] ?? c.command }}</td>
                <td>{{ m.plan.source[c.payload.source] ?? c.payload.source }}</td>
                <td :class="{ error: String(c.result).startsWith('error') }">{{ resultText(c.result) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!data.commands?.length" class="hint">{{ m.plan.nothingSent }}</p>
        </div>
      </details>

      <Transition name="toast"><p v-if="message" class="toast" role="status">{{ message }}</p></Transition>
    </template>
    <LoadError v-else-if="error" :error="error" :what="m.load.what.plan" :busy="busy" @retry="retry" />
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
const { m, reason, serverText, dayLabel: localDay } = useLocale()
const durations = computed(() => [30, 60, 120, 240].map((value) => ({ value, label: m.value.plan.durations[value]! })))
const actions = [
  { value: 'charge_grid', color: 'var(--cheap)' },
  { value: 'discharge', color: 'var(--dear)' },
  { value: 'self_use', color: 'var(--own)' },
  { value: 'solar_only', color: 'var(--hold)' },
] as const
const colorOf = (a: string | null) => actions.find((x) => x.value === a)?.color ?? 'var(--fill)'
const actionLabel = (a: string) => m.value.mode[a] ?? a
const durationLabel = computed(() => m.value.plan.durations[minutes.value] ?? `${minutes.value} min`)
const cents = (p: number) => `${num(p * 100, 1)} ct`
const slotEnd = (s: string) => new Date(new Date(s).getTime() + SLOT)

const dayLabel = (d: string | Date) => localDay(d, now.value)

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
const hasTomorrow = computed(() => (data.value?.slots ?? []).some((s: any) => dayOffset(s.slotStart, now.value) === 1))

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

// The command log in words: the battery's name, why it was sent, and what came back
const deviceNames = ref<Record<number, string>>({})
function resultText(r: string) {
  const [head, ...rest] = String(r).split(': ')
  const detail = rest.join(': ')
  const t = m.value.plan.result
  if (head === 'ok') return t.sent(detail)
  if (head === 'skipped') return t.notSent(detail)
  if (head?.startsWith('error')) return t.failed(detail)
  return r
}

async function send(body: Record<string, unknown>, done: string) {
  busy.value = true
  try {
    await api('/api/plan/override', { method: 'POST', body })
    await load()
    say(done)
  } catch (e: any) {
    say(serverText(e?.data?.statusMessage) || m.value.plan.notTaken)
  } finally {
    busy.value = false
  }
}
function startOverride() {
  if (!overrideMode.value) return
  const until = new Date(Date.now() + minutes.value * 60_000)
  send({ mode: overrideMode.value, minutes: minutes.value }, m.value.plan.overrideStarted(actionLabel(overrideMode.value), time(until)))
  overrideMode.value = null
}
const endOverride = () => send({ clear: true }, m.value.plan.overrideEnded)

let tick: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  api('/api/devices')
    .then((list: any) => (deviceNames.value = Object.fromEntries(list.map((d: any) => [d.id, d.name]))))
    .catch(() => undefined)
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
