<template>
  <div v-stagger>
    <header class="page-head"><h1>{{ m.plan.title }}</h1></header>

    <template v-if="data">
      <!-- Who steers, in one line; an override shows here too, with the way out -->
      <div class="status">
        <span class="st"><i class="dot" :class="statusDot" />{{ statusText }}</span>
        <button v-if="data.override" type="button" class="pill-btn" :disabled="busy" @click="endOverride">{{ m.plan.endOverride }}</button>
        <button v-else-if="canOverride && data.slots.length" type="button" class="pill-btn" @click="openSheet">{{ m.plan.steerSelf }}</button>
      </div>
      <p v-if="data.steering === 'ecoflow_ai'" class="hint lead">{{ m.plan.aiSteers }} <NuxtLink to="/settings">{{ m.plan.changeInSettings }}</NuxtLink></p>
      <p v-else-if="data.controlMode === 'manual'" class="hint lead">{{ m.plan.monitorOnly }} <NuxtLink to="/settings">{{ m.plan.changeInSettings }}</NuxtLink></p>

      <!-- No prices: nothing to plan with -->
      <section v-if="!data.slots.length" class="no-prices">
        <h2>{{ m.plan.noPrices }}</h2>
        <p>{{ m.plan.noPricesText }}</p>
        <NuxtLink to="/settings">{{ m.common.openSettings }}</NuxtLink>
      </section>

      <div v-else v-stagger class="cols">
        <div class="main">
          <!-- Today and tomorrow at a glance; picking a quarter finds its block below -->
          <div class="strip">
            <PriceChart v-model="selected" compact :slots="data.slots" :now="now" :label="m.plan.stripAria" />
          </div>

          <div class="timeline" :aria-label="m.plan.timelineAria" role="list">
            <template v-for="g in groups" :key="g.key">
              <div class="day" role="presentation">
                <h3>{{ g.label }}</h3>
                <span v-if="g.summary" class="d-sum">{{ g.summary }}</span>
              </div>
              <button v-if="g.earlier" type="button" class="earlier" :aria-expanded="showEarlier" @click="showEarlier = !showEarlier">
                <AppIcon name="chevron" class="chev" :class="{ open: showEarlier }" />
                {{ showEarlier ? m.plan.hideEarlier : m.plan.earlier(g.earlier) }}
              </button>
              <div
                v-for="b in g.blocks" :key="b.first" :ref="(el) => setRow(b.index, el)" role="listitem"
                class="blk" :class="{ current: b.index === currentBlock, picked: b.index === pickedBlock && b.index !== currentBlock, past: b.past }"
                :style="{ minHeight: `${b.height}px` }" @click="selected = b.index === currentBlock ? nowIndex : b.first"
              >
                <span class="b-time">
                  <b>{{ time(b.start) }}</b>
                  <small>{{ endLabel(b) }}</small>
                </span>
                <span class="b-bar" :style="{ '--c': colorOf(b.action) }">
                  <i v-if="b.index === currentBlock" :style="{ height: `${progress * 100}%` }" />
                </span>
                <span class="b-body">
                  <span class="b-top">
                    <span class="b-act">{{ b.action ? (m.mode[b.action] ?? b.action) : m.plan.noPlan }}</span>
                    <span class="b-price">{{ priceRange(b) }}</span>
                  </span>
                  <span v-if="b.reason" class="b-reason">{{ reason(b.reason) }}</span>
                  <span v-if="b.index === currentBlock" class="b-left">{{ timeLeft }}</span>
                  <span v-if="b.solarPeakW >= 200 && !b.past" class="b-sun"><AppIcon name="sun" />{{ m.plan.solarTag(num(b.solarPeakW / 1000, 1)) }}</span>
                </span>
                <span v-if="b.index === currentBlock" class="now-line" :style="{ top: `${progress * 100}%` }"><span>{{ m.plan.nowAt(time(new Date(now))) }}</span></span>
              </div>
            </template>
            <p v-if="!hasTomorrow" class="hint">{{ m.plan.tomorrowAt13 }}</p>
          </div>
        </div>

        <details class="block disclosure commands">
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
      </div>

      <!-- Steer yourself: a sheet, since it is the exception -->
      <dialog ref="sheet" class="sheet" @click.self="closeSheet">
        <form method="dialog" @submit.prevent="startOverride">
          <h2>{{ m.plan.steerSelf }}</h2>
          <p class="hint">{{ m.plan.steerSelfText }}</p>
          <div class="choices" role="radiogroup" :aria-label="m.plan.modeAria">
            <label v-for="a in actions" :key="a.value" class="choice">
              <input v-model="overrideMode" type="radio" name="override-mode" :value="a.value" />
              <i class="sw" :style="{ background: a.color }" />
              <span class="c-label">{{ m.mode[a.value] }}</span>
              <span class="c-help">{{ m.modeHelp[a.value] }}</span>
            </label>
          </div>
          <Segmented v-model="minutes" :options="durations" full :aria-label="m.plan.durationAria" />
          <div class="actions">
            <button type="button" @click="closeSheet">{{ m.plan.cancel }}</button>
            <button type="submit" class="primary" :disabled="busy || !overrideMode">{{ overrideMode ? m.plan.overrideFor(actionLabel(overrideMode), durationLabel) : m.plan.chooseMode }}</button>
          </div>
        </form>
      </dialog>

      <Transition name="toast"><p v-if="message" class="toast" role="status">{{ message }}</p></Transition>
    </template>
    <LoadError v-else-if="error" :error="error" :what="m.load.what.plan" :busy="busy" @retry="retry" />
    <div v-else class="skeleton" style="height: 320px" />
  </div>
</template>

<script setup lang="ts">
import type { PlanBlock } from '~/utils/planBlocks'

const api = useApi()
const data = ref<any>(null)
const error = ref<any>(null)
const minutes = ref(60)
const overrideMode = ref<string | null>(null)
const message = ref('')
const busy = ref(false)
const now = ref(Date.now())
const selected = ref(-1)
const showEarlier = ref(false)
const sheet = ref<HTMLDialogElement>()

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
const dayLabel = (d: string | Date) => localDay(d, now.value)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Who steers
const deviceNames = ref<Record<number, string>>({})
const canOverride = computed(() => data.value?.controlMode !== 'manual')
const statusText = computed(() => {
  const d = data.value
  if (d.override) return `${m.value.plan.override} ${m.value.plan.until(actionLabel(d.override.mode), time(d.override.until))}`
  if (d.steering === 'ecoflow_ai') return m.value.plan.aiShort
  if (d.controlMode === 'manual') return m.value.plan.monitorShort
  return m.value.plan.steers(Object.keys(deviceNames.value).length)
})
const statusDot = computed(() => (data.value.override ? 'own' : data.value.steering === 'ecoflow_ai' || data.value.controlMode === 'manual' ? '' : 'ok'))

// The timeline
const slots = computed<any[]>(() => data.value?.slots ?? [])
const blocks = computed(() => buildBlocks(slots.value))
const nowIndex = computed(() => slots.value.findIndex((s) => {
  const t = new Date(s.slotStart).getTime()
  return now.value >= t && now.value < t + SLOT
}))
const currentBlock = computed(() => blockAt(blocks.value, nowIndex.value))
const pickedBlock = computed(() => blockAt(blocks.value, selected.value))
const hasTomorrow = computed(() => slots.value.some((s) => dayOffset(s.slotStart, now.value) === 1))
const days = computed(() => daySummaries(slots.value))

// A block is as tall as it is long, within reason: one quarter 44 px, six hours or more 120 px
const heightOf = (b: PlanBlock) => Math.min(120, 44 + (blockQuarters(b) - 1) * 4)

const groups = computed(() => {
  const out: { key: string; label: string; summary: string; earlier: number; blocks: (PlanBlock & { index: number; past: boolean; height: number })[] }[] = []
  blocks.value.forEach((b, index) => {
    const past = b.end.getTime() <= now.value
    const key = localDayKey(b.start)
    let g = out.find((x) => x.key === key)
    if (!g) {
      const d = days.value.get(key)
      const solar = d && d.solarKwh >= 0.1 ? kwh(d.solarKwh, 1) : null
      g = { key, label: cap(dayLabel(b.start)), summary: d ? m.value.plan.daySummary(solar, Math.round(d.min * 100), Math.round(d.max * 100)) : '', earlier: 0, blocks: [] }
      out.push(g)
    }
    if (past) g.earlier++
    if (!past || showEarlier.value) g.blocks.push({ ...b, index, past, height: heightOf(b) })
  })
  return out.filter((g) => g.blocks.length || g.earlier)
})

const progress = computed(() => {
  const b = blocks.value[currentBlock.value]
  if (!b) return 0
  return Math.min(1, Math.max(0, (now.value - b.start.getTime()) / (b.end.getTime() - b.start.getTime())))
})
const timeLeft = computed(() => {
  const b = blocks.value[currentBlock.value]
  if (!b) return ''
  const left = Math.max(1, Math.round((b.end.getTime() - now.value) / 60_000))
  const next = blocks.value[currentBlock.value + 1]
  return m.value.plan.left(m.value.plan.duration(Math.floor(left / 60), left % 60), next?.action ? actionLabel(next.action) : null)
})
function endLabel(b: PlanBlock) {
  // A block that runs into the next day says so: "05:00 tomorrow"
  const next = new Date(b.start.getFullYear(), b.start.getMonth(), b.start.getDate() + 1)
  return b.end > next ? `${time(b.end)} ${dayLabel(b.end).toLowerCase()}` : time(b.end)
}
function priceRange(b: PlanBlock) {
  const lo = Math.round(b.min * 100)
  const hi = Math.round(b.max * 100)
  return lo === hi ? `${lo} ct` : `${lo}–${hi} ct`
}

// Picking a quarter in the strip brings its block into view
const rows = new Map<number, HTMLElement>()
function setRow(i: number, el: unknown) {
  if (el) rows.set(i, el as HTMLElement)
  else rows.delete(i)
}
watch(pickedBlock, (i, old) => {
  if (old === -1 || i < 0) return
  const b = blocks.value[i]
  if (b && b.end.getTime() <= now.value) showEarlier.value = true
  nextTick(() => rows.get(i)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
})

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
function resultText(r: string) {
  const [head, ...rest] = String(r).split(': ')
  const detail = rest.join(': ')
  const t = m.value.plan.result
  if (head === 'ok') return t.sent(detail)
  if (head === 'skipped') return t.notSent(detail)
  if (head?.startsWith('error')) return t.failed(detail)
  return r
}

function openSheet() {
  overrideMode.value = null
  sheet.value?.showModal()
}
function closeSheet() {
  sheet.value?.close()
}

async function send(body: Record<string, unknown>, done: string) {
  busy.value = true
  try {
    await api('/api/plan/override', { method: 'POST', body })
    await load()
    say(done)
    haptic('success')
    return true
  } catch (e: any) {
    say(serverText(e?.data?.statusMessage) || m.value.plan.notTaken)
    haptic('error')
    return false
  } finally {
    busy.value = false
  }
}
async function startOverride() {
  if (!overrideMode.value) return
  const mode = overrideMode.value
  const until = new Date(Date.now() + minutes.value * 60_000)
  if (await send({ mode, minutes: minutes.value }, m.value.plan.overrideStarted(actionLabel(mode), time(until)))) closeSheet()
}
const endOverride = () => send({ clear: true }, m.value.plan.overrideEnded)

let tick: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  api('/api/devices')
    .then((list: any) => (deviceNames.value = Object.fromEntries(list.map((d: any) => [d.id, d.name]))))
    .catch(() => undefined)
  // The now line moves every minute; the plan itself refreshes every 5
  let n = 0
  tick = setInterval(() => {
    const followNow = selected.value === nowIndex.value
    now.value = Date.now()
    if (followNow) selected.value = nowIndex.value
    if (++n % 5 === 0) load()
  }, 60_000)
})
onBeforeUnmount(() => clearInterval(tick))
</script>

<style scoped>
.page-head { margin-bottom: 14px; }
.status { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px; margin-bottom: 20px; }
.st { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; color: var(--text-2); }
.dot.own { background: var(--own); }
.pill-btn { flex: none; border-radius: 999px; padding: 6px 14px; font-size: 14px; }
.hint.lead { margin: -12px 0 20px; }

.no-prices { border-top: 1px solid var(--rule); padding-top: 18px; margin-bottom: 36px; }
.no-prices h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.no-prices p { margin: 0 0 14px; color: var(--text-2); max-width: 46ch; }
.no-prices a { font-weight: 600; }

.strip { margin-bottom: 8px; }

.timeline { margin-bottom: 32px; }
.day { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 22px 0 6px; }
.day h3 { font-size: 14px; font-weight: 600; color: var(--text-2); margin: 0; }
.d-sum { font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; font-stretch: 88%; }

.earlier { display: flex; align-items: center; gap: 6px; width: 100%; padding: 10px 0; border: 0; border-top: 1px solid var(--rule); border-radius: 0; background: none; font-size: 14px; font-weight: 500; color: var(--text-2); text-align: left; }
.earlier .chev { width: 16px; height: 16px; transition: transform 0.2s var(--ease-out); }
.earlier .chev.open { transform: rotate(90deg); }

.blk {
  position: relative; display: grid; grid-template-columns: 52px 6px minmax(0, 1fr); column-gap: 12px;
  padding: 0 8px 0 0; border-top: 1px solid var(--rule); cursor: pointer;
}
.blk:hover { background: var(--fill-2); }
.blk.current, .blk.picked { background: var(--fill-2); }
.blk.past { opacity: 0.55; }
.b-time { display: flex; flex-direction: column; padding: 10px 0 10px 8px; font-variant-numeric: tabular-nums; font-stretch: 80%; }
.b-time b { font-size: 16px; font-weight: 600; }
.b-time small { font-size: 12px; color: var(--text-2); }
/* The bar shows how long the block lasts; in the current block the part gone by is full colour */
.b-bar { position: relative; margin: 6px 0; border-radius: 3px; background: var(--c); }
.current .b-bar { background: color-mix(in srgb, var(--c) 35%, transparent); }
.b-bar i { position: absolute; top: 0; left: 0; right: 0; border-radius: 3px; background: var(--c); }
.b-body { display: flex; flex-direction: column; gap: 2px; padding: 10px 0; min-width: 0; }
.b-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.b-act { font-weight: 600; }
.b-price { font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; font-stretch: 85%; white-space: nowrap; }
.b-reason, .b-left { font-size: 13px; color: var(--text-2); }
.b-left { color: var(--text); font-weight: 500; }
.b-sun { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--sun); font-variant-numeric: tabular-nums; }
.b-sun svg { width: 14px; height: 14px; }
.now-line { position: absolute; left: 0; right: 0; height: 0; border-top: 1.5px solid var(--text); pointer-events: none; }
.now-line span {
  position: absolute; right: 0; top: -10px; padding: 1px 6px; border-radius: 4px;
  background: var(--text); color: var(--bg); font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums;
}
.timeline .hint { border-top: 1px solid var(--rule); padding-top: 10px; margin-top: 0; }

/* The sheet */
.sheet {
  border: 0; padding: 0; margin: auto auto 0; width: 100%; max-width: 520px;
  background: var(--surface); color: var(--text); border-radius: var(--radius) var(--radius) 0 0;
}
.sheet::backdrop { background: rgba(0, 0, 0, 0.4); }
.sheet form { padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
.sheet h2 { font-size: 19px; font-weight: 700; margin: 0; }
.sheet .hint { margin: 4px 0 14px; }
.choices { display: grid; border-top: 1px solid var(--rule); margin-bottom: 16px; }
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
.c-label { font-weight: 600; }
.c-help { grid-column: 3; font-size: 13px; color: var(--text-2); }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }

.disclosure > summary { font-size: 16px; }

.toast {
  position: fixed; left: 50%; bottom: calc(76px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 30;
  width: max-content; max-width: calc(100% - 32px); margin: 0; padding: 10px 14px; border-radius: 6px;
  background: var(--text); color: var(--bg); font-size: 14px;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.25s var(--ease-out); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 6px); }

@media (min-width: 560px) {
  .sheet { margin: auto; border-radius: var(--radius); }
}
/* Large screens: the timeline takes the width, the command log sits beside it */
@media (min-width: 1024px) {
  .commands { padding-top: 14px; }
  .toast { left: calc(50% + var(--rail) / 2); bottom: 32px; }
}
</style>
