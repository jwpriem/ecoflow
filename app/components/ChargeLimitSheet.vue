<template>
  <dialog ref="dlg" class="sheet" @close="emit('close')" @click.self="close">
    <form v-if="car" method="dialog" @submit.prevent="save">
      <h2 tabindex="-1" autofocus>{{ m.cars.limit.title(carLabel(car)) }}</h2>

      <div class="chips">
        <button v-for="p in QUICK" :key="p" type="button" :class="{ on: !other && pct === p }" @click="pick(p)">{{ m.cars.limit.quick(p) }}</button>
        <button type="button" :class="{ on: other }" @click="other = true">{{ m.cars.limit.other }}</button>
      </div>
      <div v-if="other" class="range">
        <input v-model.number="pct" type="range" min="50" max="100" step="5" :aria-label="m.cars.target" />
        <span class="value">{{ pct }}%</span>
      </div>

      <p class="small muted">{{ m.cars.limit.help }}</p>
      <p v-if="current != null" class="small muted">{{ m.cars.limit.now(current) }}</p>
      <p v-if="error" class="small neg">{{ error }}</p>

      <div class="actions">
        <button type="button" @click="close">{{ m.cars.limit.cancel }}</button>
        <button type="submit" class="primary" :disabled="busy">{{ busy ? m.cars.limit.saving : m.cars.limit.save(pct) }}</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
const props = defineProps<{ car: { id: number; name: string; state: { targetSoc?: number | null } } | null }>()
const emit = defineEmits<{ close: []; saved: [{ targetSoc: number; tibber: boolean }] }>()
const api = useApi()
const { m, serverText } = useLocale()

// Full most days, 75% when the next trip is short
const QUICK = [75, 80, 100] as const

const dlg = ref<HTMLDialogElement>()
const pct = ref(100)
const other = ref(false)
const busy = ref(false)
const error = ref('')
const current = computed(() => (props.car?.state.targetSoc != null ? Math.round(props.car.state.targetSoc * 100) : null))

function pick(p: number) {
  pct.value = p
  other.value = false
}

function open() {
  // Start from the other common choice: at 100% offer 75%, otherwise back to full
  const now = current.value
  pct.value = now == null || now >= 100 ? 75 : 100
  other.value = false
  error.value = ''
  dlg.value?.showModal()
}
function close() {
  dlg.value?.close()
}

async function save() {
  if (!props.car) return
  busy.value = true
  error.value = ''
  try {
    const r = await api<{ targetSoc: number; tibber: boolean }>(`/api/vehicles/${props.car.id}/charge-limit`, { method: 'PUT', body: { pct: pct.value } })
    emit('saved', r)
    close()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.cars.limit.failed
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
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips button { border-radius: 999px; padding: 7px 14px; }
.chips button.on { background: var(--text); color: var(--bg); border-color: var(--text); }
.range { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.range input { flex: 1; }
.value { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 4ch; text-align: right; }
.small { font-size: 13px; margin: 12px 0 0; }
.muted { color: var(--text-2); }
.neg { color: var(--alert); }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
@media (min-width: 560px) {
  .sheet { margin: auto; border-radius: var(--radius); }
}
</style>
