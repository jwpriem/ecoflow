<template>
  <dialog ref="dlg" class="sheet" @close="emit('close')" @click.self="close">
    <form v-if="music" method="dialog" @submit.prevent="start">
      <h2 tabindex="-1" autofocus>{{ m.home.music.title }}</h2>

      <template v-if="music.speakers.length">
        <p class="small muted on-speakers">{{ m.home.music.on(music.speakers.join(' + ')) }}</p>

        <label for="home-music" class="label">{{ m.settings.sonosMorning.music }}</label>
        <select id="home-music" v-model="picked" :disabled="loading && !items.length">
          <option v-if="!picked" value="" disabled>{{ loading ? m.settings.sonosMorning.loadingMusic : m.settings.sonosMorning.pickMusic }}</option>
          <!-- The morning's own music stays pickable while the list loads, or when Sonos no longer lists it -->
          <option v-if="music.source && !has(music.source)" :value="key(music.source)">{{ music.source.name }}</option>
          <optgroup v-if="favorites.length" :label="m.settings.sonosMorning.favorites">
            <option v-for="f in favorites" :key="f.id" :value="`favorite:${f.id}`">{{ f.service ? `${f.name} · ${f.service}` : f.name }}</option>
          </optgroup>
          <optgroup v-if="playlists.length" :label="m.settings.sonosMorning.playlists">
            <option v-for="p in playlists" :key="p.id" :value="`playlist:${p.id}`">{{ p.name }}</option>
          </optgroup>
        </select>
        <p v-if="loaded && !items.length" class="small muted">{{ m.settings.sonosMorning.noMusic }}</p>

        <label for="home-volume" class="label">{{ m.settings.sonosMorning.volume(volume) }}</label>
        <input id="home-volume" v-model.number="volume" type="range" min="5" max="100" step="5" class="range" :style="{ '--p': (volume - 5) / 95 }" />
      </template>
      <p v-else class="small muted">{{ m.home.music.noSpeakers }} <NuxtLink to="/settings/sonos#morning" @click="close">{{ m.common.openSettings }}</NuxtLink></p>

      <p v-if="error" class="small neg" role="status">{{ error }}</p>

      <div class="actions">
        <button type="button" @click="close">{{ m.cars.limit.cancel }}</button>
        <button v-if="music.speakers.length" type="submit" class="primary" :disabled="busy || !picked">{{ busy ? m.settings.sonosMorning.testing : m.home.music.start }}</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
interface Source { kind: 'favorite' | 'playlist'; id: string; name: string }
interface Item { id: string; name: string; service?: string | null }
/** From Home's dashboard: the morning music's speakers, music and volume, which the sheet starts from */
const props = defineProps<{ music: { speakers: string[]; source: Source | null; volume: number } | null }>()
const emit = defineEmits<{ close: []; started: [{ source: Source; volume: number }] }>()
const api = useApi()
const { m, serverText } = useLocale()

const dlg = ref<HTMLDialogElement>()
const picked = ref('')
const volume = ref(20)
const busy = ref(false)
const error = ref('')
const loading = ref(false)
const loaded = ref(false)
const favorites = ref<Item[]>([])
const playlists = ref<Item[]>([])
const items = computed(() => [...favorites.value, ...playlists.value])

const key = (s: Pick<Source, 'kind' | 'id'>) => `${s.kind}:${s.id}`
const has = (s: Source) => (s.kind === 'favorite' ? favorites.value : playlists.value).some((i) => i.id === s.id)

/** Favorites and playlists, once per visit to Home: Sonos is a cloud round trip */
async function loadMusic() {
  if (loaded.value || loading.value) return
  loading.value = true
  try {
    const households = await api<Array<{ householdId: string; favorites: Item[]; playlists: Item[] }>>('/api/sonos/music')
    // The speakers are in one household; the one that holds the morning's music, or else the first
    const own = props.music?.source
    const h = (own && households.find((x) => (own.kind === 'favorite' ? x.favorites : x.playlists).some((i) => i.id === own.id))) || households[0]
    favorites.value = h?.favorites ?? []
    playlists.value = h?.playlists ?? []
    loaded.value = true
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.common.failed
  } finally {
    loading.value = false
  }
}

function open() {
  picked.value = props.music?.source ? key(props.music.source) : ''
  volume.value = props.music?.volume ?? 20
  error.value = ''
  dlg.value?.showModal()
  if (props.music?.speakers.length) loadMusic()
}
function close() {
  dlg.value?.close()
}

async function start() {
  const [kind, ...rest] = picked.value.split(':')
  if (!kind || !rest.length) return
  busy.value = true
  error.value = ''
  try {
    const r = await api<{ source: Source; volume: number }>('/api/sonos/play', { method: 'POST', body: { source: { kind, id: rest.join(':') }, volume: volume.value } })
    haptic('success')
    emit('started', r)
    close()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.home.music.failed
    haptic('error')
  } finally {
    busy.value = false
  }
}

watch(
  () => props.music,
  (v) => nextTick(() => (v ? open() : close())),
)
</script>

<style scoped>
.sheet {
  border: 0; padding: 0; margin: auto auto 0; width: 100%; max-width: 520px;
  background: var(--surface); color: var(--text); border-radius: var(--radius) var(--radius) 0 0;
}
.sheet::backdrop { background: rgba(0, 0, 0, 0.4); }
form { padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
h2 { font-size: 19px; font-weight: 700; margin: 0 0 6px; outline: none; }
.on-speakers { margin: 0 0 14px; }
.label { display: block; font-size: 14px; font-weight: 600; margin: 14px 0 6px; }
select { width: 100%; }
.range { width: 100%; }
.small { font-size: 13px; margin: 10px 0 0; }
.muted { color: var(--text-2); }
.neg { color: var(--alert); }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
@media (min-width: 560px) {
  .sheet { margin: auto; border-radius: var(--radius); }
}
</style>
