<template>
  <div>
    <h1>Plan</h1>
    <template v-if="data">
      <div class="card">
        <div class="spread">
          <h2>Prices today &amp; tomorrow</h2>
          <span class="pill" v-if="data.slots[0]">{{ data.slots[0].source === 'tibber' ? 'Tibber' : 'fake prices' }}</span>
        </div>
        <div class="row small" style="margin-bottom: 8px">
          <span v-for="a in actions" :key="a.value" class="row" style="gap: 6px">
            <span class="dot" :style="{ background: `var(${a.color})` }" /> {{ a.label }}
          </span>
        </div>
        <BarChart
          :labels="data.slots.map((s: any) => label(s.slotStart))"
          :series="[{ label: 'Price', data: data.slots.map((s: any) => s.total), color: '--neutral', colors: data.slots.map((s: any) => colorOf(s.action)) }]"
          :legend="false"
          :format="(v) => eur(v, 3)"
        />
      </div>

      <div class="card">
        <h2>Control</h2>
        <div class="row" style="margin-bottom: 12px">
          <div class="segmented">
            <button :class="{ active: data.controlMode === 'auto' }" @click="send({ controlMode: 'auto' })">Automatic</button>
            <button :class="{ active: data.controlMode === 'manual' }" @click="send({ controlMode: 'manual' })">Monitor only</button>
          </div>
        </div>
        <p v-if="data.override" class="small">
          Override active: <strong>{{ MODE_LABEL[data.override.mode] }}</strong> until {{ time(data.override.until) }}
          <button style="margin-left: 8px" @click="send({ clear: true })">Clear</button>
        </p>
        <div class="row">
          <select v-model.number="minutes" style="width: auto">
            <option :value="30">30 min</option>
            <option :value="60">1 hour</option>
            <option :value="120">2 hours</option>
            <option :value="240">4 hours</option>
          </select>
          <button v-for="a in actions" :key="a.value" @click="send({ mode: a.value, minutes })">{{ a.label }}</button>
        </div>
        <p v-if="message" class="small muted">{{ message }}</p>
      </div>

      <div class="card">
        <h2>Upcoming</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Price</th><th>Action</th><th>Why</th></tr></thead>
            <tbody>
              <tr v-for="s in upcoming" :key="String(s.slotStart)">
                <td>{{ label(s.slotStart) }}</td>
                <td>{{ eur(s.total, 3) }}</td>
                <td>{{ MODE_LABEL[s.action] ?? '–' }}<template v-if="s.targetW"> · {{ watt(s.targetW) }}</template></td>
                <td class="muted" style="text-align: left">{{ s.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Commands sent</h2>
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
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const data = ref<any>(null)
const minutes = ref(60)
const message = ref('')

const actions = [
  { value: 'charge_grid', label: 'Charge from grid', color: '--series-1' },
  { value: 'discharge', label: 'Discharge', color: '--series-2' },
  { value: 'self_use', label: 'Self-use', color: '--series-3' },
  { value: 'solar_only', label: 'Solar only', color: '--neutral' },
] as const
const colorOf = (a: string | null) => actions.find((x) => x.value === a)?.color ?? '--neutral'

const upcoming = computed(() => {
  const now = Date.now() - 15 * 60_000
  return (data.value?.slots ?? []).filter((s: any) => new Date(s.slotStart).getTime() >= now).slice(0, 48)
})

function label(d: string) {
  const dt = new Date(d)
  const today = new Date().toDateString() === dt.toDateString()
  return (today ? '' : dt.toLocaleDateString('nl-NL', { weekday: 'short' }) + ' ') + time(dt)
}

async function load() {
  data.value = await api('/api/plan')
}
async function send(body: Record<string, unknown>) {
  const r: any = await api('/api/plan/override', { method: 'POST', body })
  message.value = `Batteries now: ${MODE_LABEL[r.command.mode]} (${r.command.source})`
  await load()
}
onMounted(load)
</script>
