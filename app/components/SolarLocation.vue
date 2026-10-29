<template>
  <!-- The household's rough location (0.1°, about 10 km) the sun forecast is fetched for -->
  <div class="list">
    <div class="list-row">
      <span class="stack-text">
        <span class="title">{{ m.location.title }}</span>
        <span class="small muted">{{ summary }}</span>
      </span>
      <button v-if="canEdit && !editing" type="button" class="plain" @click="start">{{ m.location.change }}</button>
    </div>
    <!-- Not a form: it also sits inside the onboarding step's form -->
    <div v-if="editing" class="list-row edit" @keydown.enter.prevent="save">
      <label class="coord"><span class="small muted">{{ m.location.lat }}</span><input v-model="lat" type="number" step="0.1" min="-90" max="90" inputmode="decimal" /></label>
      <label class="coord"><span class="small muted">{{ m.location.lon }}</span><input v-model="lon" type="number" step="0.1" min="-180" max="180" inputmode="decimal" /></label>
      <span class="buttons">
        <button v-if="location?.source === 'manual'" type="button" :disabled="busy" @click="useTibber">{{ m.location.useTibber }}</button>
        <button type="button" :disabled="busy" @click="editing = false">{{ m.location.cancel }}</button>
        <button type="button" class="primary" :disabled="busy || lat === '' || lon === ''" @click="save">{{ m.location.save }}</button>
      </span>
    </div>
  </div>
  <p class="foot" :class="{ error: msg && !msg.ok }" role="status">{{ msg?.text ?? m.location.foot }}</p>
</template>

<script setup lang="ts">
type Location = { lat: number; lon: number; place?: string; source: 'tibber' | 'manual' } | null
const api = useApi()
const { me } = useAuth()
const { m, serverText } = useLocale()
const location = ref<Location>(null)
const editing = ref(false)
const busy = ref(false)
const lat = ref('')
const lon = ref('')
const msg = ref<{ ok: boolean; text: string } | null>(null)
const canEdit = computed(() => me.value?.member === 'owner')
const fmt = (n: number) => n.toFixed(1)

const summary = computed(() => {
  const l = location.value
  if (!l) return m.value.location.unset
  const where = `${l.place ? `${m.value.location.near(l.place)} · ` : ''}${fmt(l.lat)}, ${fmt(l.lon)}`
  return `${where} · ${l.source === 'manual' ? m.value.location.byYou : m.value.location.fromTibber}`
})

async function load() {
  location.value = (await api<{ location: Location }>('/api/household')).location
}

function start() {
  lat.value = location.value ? fmt(location.value.lat) : ''
  lon.value = location.value ? fmt(location.value.lon) : ''
  msg.value = null
  editing.value = true
}

async function put(body: Record<string, unknown>) {
  busy.value = true
  msg.value = null
  try {
    location.value = (await api<{ location: Location }>('/api/household/location', { method: 'PUT', body })).location
    editing.value = false
    msg.value = { ok: true, text: m.value.location.saved }
  } catch (e: any) {
    msg.value = { ok: false, text: serverText(e?.data?.statusMessage) || e?.message || m.value.common.failed }
  } finally {
    busy.value = false
  }
}
const save = () => put({ lat: lat.value, lon: lon.value })
const useTibber = () => put({ clear: true })

onMounted(() => load().catch(() => undefined))
</script>

<style scoped>
.foot { font-size: 13px; color: var(--text-2); margin: 8px 2px 0; max-width: 60ch; }
.foot.error { color: var(--alert); }
.edit { flex-wrap: wrap; gap: 10px 12px; align-items: flex-end; }
.coord { display: flex; flex-direction: column; gap: 4px; flex: 1 1 110px; }
.coord input { width: 100%; }
.buttons { display: flex; gap: 8px; margin-left: auto; }
.stack-text { display: flex; flex-direction: column; gap: 2px; }
</style>
