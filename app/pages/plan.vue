<template>
  <div>
    <header class="page-head">
      <h1>Plan</h1>
      <span v-if="data?.slots[0]" class="sub">{{ data.slots[0].source === 'tibber' ? 'Tibber prices' : 'Fake prices' }}</span>
    </header>

    <template v-if="data">
      <section class="card rise">
        <div class="card-head">
          <span class="eyebrow">Price & plan</span>
          <span v-if="cheapest && dearest" class="small muted">{{ eur(cheapest.total, 2) }} – {{ eur(dearest.total, 2) }}</span>
        </div>
        <div class="chart">
          <BarChart
            :labels="data.slots.map((s: any) => label(s.slotStart))"
            :series="[{ label: 'Price', data: data.slots.map((s: any) => s.total), color: '--c-hold', colors: data.slots.map((s: any) => colorOf(s.action)) }]"
            :legend="false"
            :format="(v) => eur(v, 3)"
          />
        </div>
        <div class="legend">
          <span v-for="a in actions" :key="a.value"><i :style="{ background: `var(${a.color})` }" /> {{ a.label }}</span>
        </div>
      </section>

      <h3 class="section-title">Control</h3>
      <section class="card rise">
        <Segmented
          :model-value="data.controlMode"
          :options="[{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Monitor only' }]"
          full
          @update:model-value="(v) => send({ controlMode: v })"
        />
        <p class="small muted hint">{{ data.controlMode === 'auto' ? 'The plan is sent to the batteries every 15 minutes.' : 'The batteries run on their own; the plan is only shown.' }}</p>

        <div v-if="data.override" class="override">
          <span class="dot" :style="{ background: `var(${colorOf(data.override.mode)})` }" />
          <div class="o-text"><strong>{{ MODE_LABEL[data.override.mode] }}</strong><span class="muted"> until {{ time(data.override.until) }}</span></div>
          <button class="plain" @click="send({ clear: true })">Clear</button>
        </div>

        <div class="o-head">
          <span class="label">Override for</span>
          <Segmented v-model="minutes" :options="durations" />
        </div>
        <div class="actions">
          <button v-for="a in actions" :key="a.value" class="action" :class="{ on: data.override?.mode === a.value }" @click="send({ mode: a.value, minutes })">
            <span class="a-icon" :style="{ background: `var(${a.color})` }"><AppIcon :name="a.icon" /></span>
            <span>{{ a.label }}</span>
          </button>
        </div>
        <Transition name="toast"><p v-if="message" class="toast">{{ message }}</p></Transition>
      </section>

      <h3 class="section-title">Upcoming</h3>
      <div class="list rise">
        <div v-for="r in runs" :key="String(r.start)" class="list-row">
          <div class="lead">
            <span class="bar-v" :style="{ background: `var(${colorOf(r.action)})` }" />
            <div style="min-width: 0">
              <div class="title">{{ MODE_LABEL[r.action] ?? '–' }}</div>
              <div class="small muted reason">{{ r.reason || '—' }}</div>
            </div>
          </div>
          <div class="detail">
            <div>{{ label(r.start) }}–{{ time(r.end) }}</div>
            <div class="small">{{ eur(r.min, 3) }}<template v-if="r.max !== r.min"> – {{ eur(r.max, 3) }}</template></div>
          </div>
        </div>
      </div>

      <section class="card rise">
        <details class="disclosure">
          <summary>Commands sent <AppIcon name="chevron" class="chev" style="width: 18px; height: 18px" /></summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Battery</th><th>Mode</th><th>Source</th><th>Result</th></tr></thead>
              <tbody>
                <tr v-for="c in data.commands" :key="c.id">
                  <td>{{ label(c.ts) }}</td>
                  <td>#{{ c.deviceId }}</td>
                  <td>{{ MODE_LABEL[c.command] }}</td>
                  <td>{{ c.payload.source }}</td>
                  <td>{{ c.result }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </template>
    <div v-else class="skeleton" style="height: 300px" />
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const data = ref<any>(null)
const minutes = ref(60)
const message = ref('')

const durations = [
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 240, label: '4h' },
] as const
const actions = [
  { value: 'charge_grid', label: 'Charge from grid', color: '--c-grid-charge', icon: 'grid' },
  { value: 'discharge', label: 'Discharge', color: '--c-discharge', icon: 'house' },
  { value: 'self_use', label: 'Self-use', color: '--c-self-use', icon: 'bolt' },
  { value: 'solar_only', label: 'Solar only', color: '--c-hold', icon: 'sun' },
] as const
const colorOf = (a: string | null) => actions.find((x) => x.value === a)?.color ?? '--c-hold'

const upcoming = computed(() => {
  const now = Date.now() - 15 * 60_000
  return (data.value?.slots ?? []).filter((s: any) => new Date(s.slotStart).getTime() >= now)
})
// Consecutive slots with the same action and reason become one row
const runs = computed(() => {
  const out: { start: string; end: Date; action: string; reason: string; min: number; max: number }[] = []
  for (const s of upcoming.value) {
    const end = new Date(new Date(s.slotStart).getTime() + 15 * 60_000)
    const last = out[out.length - 1]
    if (last && last.action === s.action && last.reason === (s.reason ?? '')) {
      last.end = end
      last.min = Math.min(last.min, s.total)
      last.max = Math.max(last.max, s.total)
    } else out.push({ start: s.slotStart, end, action: s.action, reason: s.reason ?? '', min: s.total, max: s.total })
  }
  return out.slice(0, 16)
})
const cheapest = computed(() => upcoming.value.reduce((m: any, s: any) => (!m || s.total < m.total ? s : m), null))
const dearest = computed(() => upcoming.value.reduce((m: any, s: any) => (!m || s.total > m.total ? s : m), null))

function label(d: string) {
  const dt = new Date(d)
  const today = new Date().toDateString() === dt.toDateString()
  return (today ? '' : dt.toLocaleDateString('nl-NL', { weekday: 'short' }) + ' ') + time(dt)
}

async function load() {
  data.value = await api('/api/plan')
}
let toast: ReturnType<typeof setTimeout>
async function send(body: Record<string, unknown>) {
  const r: any = await api('/api/plan/override', { method: 'POST', body })
  message.value = `Batteries now: ${MODE_LABEL[r.command.mode]} (${r.command.source})`
  clearTimeout(toast)
  toast = setTimeout(() => (message.value = ''), 3500)
  await load()
}
onMounted(load)
</script>

<style scoped>
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 12px; color: var(--text-2); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.hint { margin: 10px 4px 0; }
.override { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding: 10px 12px; border-radius: 14px; background: var(--fill-2); }
.o-text { flex: 1; font-size: 15px; }
.o-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 18px 0 10px; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.action { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px; border-radius: 16px; background: var(--surface-2); text-align: left; font-size: 15px; font-weight: 600; }
.action.on { box-shadow: inset 0 0 0 2px var(--text-2); }
.a-icon { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #fff; }
.a-icon svg { width: 18px; height: 18px; }
.toast { margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; background: var(--surface-3); font-size: 13px; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.35s var(--spring); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px) scale(0.98); }
.bar-v { width: 4px; align-self: stretch; border-radius: 2px; flex: none; }
.list-row { align-items: stretch; }
.reason { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 46vw; }
.detail { display: flex; flex-direction: column; justify-content: center; }
</style>
