<template>
  <dialog ref="dlg" class="sheet" @close="emit('close')" @click.self="close">
    <form v-if="car" method="dialog" @submit.prevent="save">
      <h2 tabindex="-1" autofocus>{{ m.cars.departure.title(car.name) }}</h2>

      <p class="label">{{ m.cars.departure.day }}</p>
      <div class="chips">
        <button v-for="d in days" :key="d.key" type="button" :class="{ on: day === d.key }" @click="day = d.key">{{ d.label }}</button>
      </div>

      <p class="label">{{ m.cars.departure.time }}</p>
      <div class="chips">
        <button v-for="t in QUICK" :key="t" type="button" :class="{ on: choice === t }" @click="choice = t">{{ t }}</button>
        <button type="button" :class="{ on: choice === 'custom' }" @click="choice = 'custom'">{{ m.cars.departure.custom }}</button>
      </div>
      <input v-if="choice === 'custom'" v-model="custom" class="time" type="time" step="300" required />

      <p class="small muted">{{ past ? m.cars.departure.past : m.cars.departure.others }}</p>
      <p v-if="current" class="small muted">{{ m.cars.departure.now }}: {{ current }}</p>
      <p v-if="error" class="small neg">{{ error }}</p>

      <div class="actions">
        <button type="button" @click="close">{{ m.cars.departure.cancel }}</button>
        <button type="submit" class="primary" :disabled="busy || past || !time">{{ busy ? m.cars.departure.saving : m.cars.departure.save }}</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
const props = defineProps<{ car: { id: number; name: string } | null }>()
const emit = defineEmits<{ close: []; saved: [{ day: string; time: string }] }>()
const api = useApi()
const { m, serverText } = useLocale()

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const QUICK = ['08:00', '12:00'] as const

const dlg = ref<HTMLDialogElement>()
const day = ref<string>('')
const choice = ref<string>('08:00')
const custom = ref('07:30')
const busy = ref(false)
const error = ref('')
const current = ref('')

// The coming seven days; the server only needs the weekday
const days = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const label = i === 0 ? m.value.day.today : i === 1 ? m.value.day.tomorrow : d.toLocaleDateString(m.value.dateLocale, { weekday: 'short', day: 'numeric' })
    return { key: WEEKDAYS[d.getDay()]!, label, offset: i }
  }),
)
const time = computed(() => (choice.value === 'custom' ? custom.value : choice.value))
// A time already gone today would mean next week in Tibber's weekly schedule
const past = computed(() => {
  if (day.value !== days.value[0]!.key || !time.value) return false
  const [h, min] = time.value.split(':').map(Number)
  const now = new Date()
  return h! * 60 + min! <= now.getHours() * 60 + now.getMinutes()
})

function weekdayLabel(key: string) {
  const d = days.value.find((x) => x.key === key)!
  return new Date(Date.now() + d.offset * 86_400_000).toLocaleDateString(m.value.dateLocale, { weekday: 'short' })
}

async function loadCurrent(id: number) {
  current.value = ''
  try {
    const r = await api<{ days: Record<string, string | null> }>(`/api/vehicles/${id}/departure`)
    const set = WEEKDAYS.slice(1).concat('sunday').filter((d) => r.days[d]).map((d) => `${weekdayLabel(d)} ${r.days[d]}`)
    current.value = set.length ? set.join(', ') : m.value.cars.departure.none
  } catch {
    // Only informative: setting a departure still works or shows its own error
  }
}

function open() {
  // Default to the first day 08:00 is still ahead: today early in the morning, else tomorrow
  const early = new Date().getHours() < 7
  day.value = days.value[early ? 0 : 1]!.key
  choice.value = '08:00'
  error.value = ''
  dlg.value?.showModal()
  loadCurrent(props.car!.id)
}
function close() {
  dlg.value?.close()
}

async function save() {
  if (!props.car || past.value) return
  busy.value = true
  error.value = ''
  try {
    await api(`/api/vehicles/${props.car.id}/departure`, { method: 'PUT', body: { day: day.value, time: time.value } })
    emit('saved', { day: day.value, time: time.value })
    close()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.cars.departure.failed
  } finally {
    busy.value = false
  }
}

watch(
  () => props.car,
  (c) => nextTick(() => (c ? open() : close())),
  { immediate: true },
)
</script>

<style scoped>
.sheet {
  border: 0; padding: 0; margin: auto auto 0; width: 100%; max-width: 520px;
  background: var(--surface); color: var(--text); border-radius: var(--radius) var(--radius) 0 0;
}
.sheet::backdrop { background: rgba(0, 0, 0, 0.4); }
form { padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
h2 { font-size: 19px; font-weight: 700; margin: 0 0 14px; outline: none; }
.label { margin: 14px 0 8px; font-size: 14px; color: var(--text-2); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips button { border-radius: 999px; padding: 7px 14px; }
.chips button.on { background: var(--text); color: var(--bg); border-color: var(--text); }
.time { margin-top: 10px; font-size: 17px; }
.small { font-size: 13px; margin: 12px 0 0; }
.muted { color: var(--text-2); }
.neg { color: var(--alert); }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
@media (min-width: 560px) {
  .sheet { margin: auto; border-radius: var(--radius); }
}
</style>
