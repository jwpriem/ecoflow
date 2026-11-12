<template>
  <div v-stagger>
    <header class="page-head">
      <h1>{{ m.lights.title }}</h1>
      <template v-if="state?.signedIn && state.lights.length">
        <button v-if="floor" type="button" class="new" :class="{ on: arranging }" @click="arranging = !arranging">
          {{ arranging ? m.lights.plan.done : m.lights.plan.arrange }}
        </button>
        <button v-else type="button" class="new" @click="editing = { group: null }"><AppIcon name="plus" />{{ m.lights.newGroup }}</button>
      </template>
    </header>
    <LoadError v-if="loadError" :error="loadError" :what="m.lights.what" :busy="busy" @retry="retryLoad" />

    <template v-else-if="state">
      <!-- Not connected, or connected but not signed in yet -->
      <section v-if="!state.signedIn" class="nothing">
        <h2>{{ state.connected ? m.lights.signInTitle : m.lights.connectTitle }}</h2>
        <p>{{ state.connected ? m.lights.signInText : m.lights.connectText }}</p>
        <NuxtLink to="/settings" class="go">{{ m.common.openSettings }}</NuxtLink>
      </section>
      <p v-else-if="!state.lights.length" class="foot">{{ m.lights.empty }}</p>

      <template v-else>
        <!-- Floors with a plan, and the list of everything -->
        <div class="views" role="tablist">
          <button v-for="f in floors" :key="f.id" type="button" role="tab" :aria-selected="view === f.id" :class="{ on: view === f.id }" @click="setView(f.id)">{{ f.name }}</button>
          <button type="button" role="tab" :aria-selected="view === 'list'" :class="{ on: view === 'list' }" @click="setView('list')">{{ m.lights.plan.list }}</button>
          <button type="button" class="add" :aria-label="m.lights.plan.addFloor" @click="floorEdit = { floor: null }"><AppIcon name="plus" /><span v-if="!floors.length">{{ m.lights.plan.addFloor }}</span></button>
        </div>

        <section v-if="floor" class="floor">
          <FloorPlan :floor="floor" :lights="state.lights" :groups="state.groups" :editing="arranging" @open="openPin" @placements="savePlacements" />
          <div v-if="arranging" class="floor-actions">
            <p class="hint">{{ m.lights.plan.arrangeHint }}</p>
            <button type="button" class="plain" @click="floorEdit = { floor }">{{ m.lights.plan.editFloor }}</button>
          </div>
          <p v-if="floorError" class="error" role="status">{{ floorError }}</p>
        </section>

        <template v-else>
        <p v-if="!floors.length" class="hint invite">{{ m.lights.plan.invite }}</p>
        <!-- The groups made here (Hue zones) first: these are the "one lamp" the person thinks in -->
        <section class="block">
          <div class="block-head"><h2>{{ m.lights.groups }}</h2></div>
          <p v-if="!zones.length" class="hint">{{ m.lights.groupsHint }}</p>
          <div v-stagger class="tiles">
            <div v-for="g in zones" :key="g.id" class="tile" :class="{ lit: g.on }">
              <button type="button" class="tile-main" @click="openGroup(g)">
                <span class="glow" :style="groupGlow(g)" aria-hidden="true" />
                <span class="tile-text">
                  <span class="tile-name">{{ g.name }}</span>
                  <span class="tile-sub">{{ m.lights.lamps(g.lightIds.length) }} · {{ onText(g) }}</span>
                </span>
              </button>
              <label class="switch">
                <input type="checkbox" :checked="g.on" :aria-label="m.lights.toggle(g.name)" @change="change(groupTarget(g), { on: ($event.target as HTMLInputElement).checked })" />
                <span />
              </label>
            </div>
          </div>
        </section>

        <!-- The rooms from the Hue app, with their lamps -->
        <section class="block">
          <div class="block-head"><h2>{{ m.lights.rooms }}</h2></div>
          <div v-stagger class="rooms">
            <div v-for="r in roomList" :key="r.id" class="room">
              <div class="room-head">
                <button type="button" class="room-name" :disabled="!r.groupedLightId" @click="r.groupedLightId && openGroup(r)">
                  {{ r.name }} <span class="tile-sub">{{ onText(r) }}</span>
                </button>
                <label v-if="r.groupedLightId" class="switch">
                  <input type="checkbox" :checked="r.on" :aria-label="m.lights.toggle(r.name)" @change="change(groupTarget(r), { on: ($event.target as HTMLInputElement).checked })" />
                  <span />
                </label>
              </div>
              <div class="list">
                <div v-for="l in lampsOf(r)" :key="l.id" class="list-row lamp">
                  <button type="button" class="lead lamp-btn" @click="openLight(l)">
                    <span class="dot-glow" :style="glow(lampRgb(l), l.on ? l.brightness : 0)" aria-hidden="true" />
                    <span class="title">{{ l.name }}</span>
                    <span class="detail">{{ !l.reachable ? m.lights.unreachable : l.on ? `${l.brightness}%` : '' }}</span>
                  </button>
                  <label class="switch">
                    <input type="checkbox" :checked="l.on" :aria-label="m.lights.toggle(l.name)" @change="change(lightTarget(l), { on: ($event.target as HTMLInputElement).checked })" />
                    <span />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </section>
        <p class="foot">{{ m.lights.foot }}</p>
        </template>
        <p v-if="sendError" class="error" role="status">{{ sendError }}</p>
      </template>

      <LightSheet :target="sheet" :lights="state.lights" @close="sheetId = null" @change="(c) => sheet && change(sheet, c)" @member="(id, c) => changeLight(id, c)" @edit="editFromSheet" />
      <FloorSheet :open="!!floorEdit" :floor="floorEdit?.floor ?? null" @close="floorEdit = null" @saved="afterFloor" />
      <GroupSheet :open="!!editing" :group="editing?.group ?? null" :lights="state.lights" :rooms="rooms" @close="editing = null" @saved="safeLoad" />
    </template>

    <template v-else>
      <div class="skeleton" style="height: 120px; margin-bottom: 16px" />
      <div class="skeleton" style="height: 220px" />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { LightChange, SheetTarget } from '~/components/LightSheet.vue'

type Lamp = {
  id: string; name: string; archetype: string | null; on: boolean; brightness: number; mirek: number | null; xy: Xy | null
  supports: { dim: boolean; temperature: boolean; color: boolean }; mirekMin: number; mirekMax: number; reachable: boolean
}
type Group = { id: string; kind: 'room' | 'zone'; name: string; archetype: string | null; groupedLightId: string | null; lightIds: string[]; on: boolean; brightness: number }
type State = { connected: boolean; signedIn: boolean; lights: Lamp[]; groups: Group[] }

const api = useApi()
const { m, serverText } = useLocale()

const state = ref<State | null>(null)
const loadError = ref<any>(null)
const busy = ref(false)
const sendError = ref('')
const sheetId = ref<string | null>(null)
const editing = ref<{ group: Group | null } | null>(null)

// Floors: their plans and where the lamps are on them. The chosen view is remembered on this device
type Floor = { id: number; name: string; sort: number; plan: string | null; placements: Placement[] }
type Placement = { kind: 'light' | 'group'; id: string; x: number; y: number }
const floors = ref<Floor[]>([])
const view = ref<number | 'list'>('list')
const arranging = ref(false)
const floorEdit = ref<{ floor: Floor | null } | null>(null)
const floorError = ref('')
const floor = computed(() => (view.value === 'list' ? null : (floors.value.find((f) => f.id === view.value) ?? null)))
const VIEW_KEY = 'lights.view'
function setView(v: number | 'list') {
  view.value = v
  arranging.value = false
  try {
    localStorage.setItem(VIEW_KEY, String(v))
  } catch {}
}
/** On first load: back to the view chosen last time, else the first floor */
async function loadFloors() {
  floors.value = await api<Floor[]>('/api/lights/floors')
  let saved: string | null = null
  try {
    saved = localStorage.getItem(VIEW_KEY)
  } catch {}
  if (saved === 'list') view.value = 'list'
  else if (saved && floors.value.some((f) => f.id === Number(saved))) view.value = Number(saved)
  else view.value = floors.value[0]?.id ?? 'list'
}
async function afterFloor(id: number | null) {
  floors.value = await api<Floor[]>('/api/lights/floors').catch(() => floors.value)
  if (id) setView(id)
  else setView(floors.value[0]?.id ?? 'list')
}
async function savePlacements(p: Placement[]) {
  const f = floor.value
  if (!f) return
  f.placements = p
  try {
    await api(`/api/lights/floors/${f.id}`, { method: 'PUT', body: { placements: p } })
    floorError.value = ''
  } catch (e: any) {
    floorError.value = serverText(e?.data?.statusMessage) || m.value.lights.failed
  }
}
const openPin = (p: Placement) => (sheetId.value = p.id)

const zones = computed(() => state.value?.groups.filter((g) => g.kind === 'zone') ?? [])
const rooms = computed(() => state.value?.groups.filter((g) => g.kind === 'room') ?? [])
// Lamps in no room get a list of their own at the end
const roomList = computed(() => {
  const inRoom = new Set(rooms.value.flatMap((r) => r.lightIds))
  const rest = (state.value?.lights ?? []).filter((l) => !inRoom.has(l.id)).map((l) => l.id)
  const list = rooms.value.filter((r) => r.lightIds.length)
  return rest.length ? [...list, { id: 'rest', kind: 'room', name: m.value.lights.noRoom, archetype: null, groupedLightId: null, lightIds: rest, on: false, brightness: 0 } as Group] : list
})

const lampsOf = (g: Group) => (state.value?.lights ?? []).filter((l) => g.lightIds.includes(l.id))
const onText = (g: Group) => {
  const ls = lampsOf(g)
  return m.value.lights.lampsOn(ls.filter((l) => l.on).length, ls.length)
}
function groupGlow(g: Group) {
  const lit = lampsOf(g).filter((l) => l.on)
  const avg = lit.length ? lit.reduce((s, l) => s + l.brightness, 0) / lit.length : 0
  return glow(mixRgb(lit.map(lampRgb).filter((c): c is Rgb => !!c)), avg)
}

// What the sheet works on, kept live from the state so it follows every change
const groupTarget = (g: Group): SheetTarget => ({ kind: 'group', id: g.groupedLightId ?? g.id, name: g.name, on: lampsOf(g).some((l) => l.on), brightness: groupBrightness(g), zone: g.kind === 'zone', lightIds: g.lightIds })
const lightTarget = (l: Lamp): SheetTarget => ({ kind: 'light', id: l.id, name: l.name, on: l.on, brightness: l.brightness, lightIds: [l.id] })
function groupBrightness(g: Group) {
  const lit = lampsOf(g).filter((l) => l.on)
  return lit.length ? Math.round(lit.reduce((s, l) => s + l.brightness, 0) / lit.length) : 0
}
const sheet = computed<SheetTarget | null>(() => {
  if (!sheetId.value || !state.value) return null
  const g = state.value.groups.find((x) => x.groupedLightId === sheetId.value)
  if (g) return groupTarget(g)
  const l = state.value.lights.find((x) => x.id === sheetId.value)
  return l ? lightTarget(l) : null
})
const openGroup = (g: Group) => (sheetId.value = g.groupedLightId)
const openLight = (l: Lamp) => (sheetId.value = l.id)
function editFromSheet() {
  const g = state.value?.groups.find((x) => x.groupedLightId === sheetId.value)
  sheetId.value = null
  if (g) editing.value = { group: g }
}

/** Show the change straight away; the bridge follows a moment later */
function applyLocal(ids: string[], c: LightChange) {
  for (const l of state.value?.lights ?? []) {
    if (!ids.includes(l.id)) continue
    if (c.on !== undefined) l.on = c.on
    if (c.brightness !== undefined) {
      if (c.brightness <= 0) l.on = false
      else Object.assign(l, { brightness: Math.round(c.brightness), on: true })
    }
    if (c.mirek !== undefined && l.supports.temperature) Object.assign(l, { mirek: c.mirek, xy: null })
    else if (c.xy && l.supports.color) Object.assign(l, { xy: c.xy, mirek: null })
  }
}

// Sliders send many changes: send at most one per lamp every 250 ms and one per group every second
// (the bridge's own limits), always ending with the last value
const pending = new Map<string, { change: LightChange; timer?: ReturnType<typeof setTimeout> }>()
let lastTouch = 0
function send(t: SheetTarget, c: LightChange) {
  const key = `${t.kind}:${t.id}`
  const slot = pending.get(key) ?? { change: {} }
  // A white tone and a colour exclude each other: the last one wins
  if (c.mirek !== undefined) delete slot.change.xy
  if (c.xy) delete slot.change.mirek
  slot.change = { ...slot.change, ...c }
  pending.set(key, slot)
  if (slot.timer) return
  const flush = () => {
    const s = pending.get(key)
    if (!s || !Object.keys(s.change).length) return pending.delete(key)
    const body = s.change
    s.change = {}
    api(`/api/lights/${t.kind}/${t.id}`, { method: 'PUT', body })
      .then(() => (sendError.value = ''))
      .catch((e: any) => {
        sendError.value = serverText(e?.data?.statusMessage) || m.value.lights.failed
        haptic('error')
        safeLoad()
      })
    s.timer = setTimeout(() => {
      s.timer = undefined
      flush()
    }, t.kind === 'group' ? 1000 : 250)
  }
  flush()
}

function change(t: SheetTarget, c: LightChange) {
  lastTouch = Date.now()
  applyLocal(t.lightIds, c)
  send(t, c)
}
function changeLight(id: string, c: LightChange) {
  const l = state.value?.lights.find((x) => x.id === id)
  if (l) change(lightTarget(l), c)
}

async function load() {
  state.value = await api<State>('/api/lights')
}
async function safeLoad() {
  try {
    await load()
    loadError.value = null
  } catch (e) {
    // Keep showing the lamps when a refresh fails; only a first load shows the error
    if (!state.value) loadError.value = e
  }
}
async function retryLoad() {
  busy.value = true
  await safeLoad()
  busy.value = false
}

// Follow changes made elsewhere (the Hue app, a switch on the wall), but not right after a change here
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  safeLoad()
  loadFloors().catch(() => undefined)
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastTouch > 5000 && !editing.value && !arranging.value) safeLoad()
  }, 10_000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  for (const s of pending.values()) clearTimeout(s.timer)
})
</script>

<style scoped>
.new { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 7px 14px 7px 10px; font-size: 14px; }
.new svg { width: 16px; height: 16px; }
.new.on { background: var(--text); color: var(--bg); border-color: var(--text); }
.views { display: flex; gap: 8px; overflow-x: auto; margin: -8px 0 18px; padding: 2px; scrollbar-width: none; }
.views::-webkit-scrollbar { display: none; }
.views button { border-radius: 999px; padding: 7px 14px; font-size: 14px; white-space: nowrap; flex: none; display: inline-flex; align-items: center; gap: 6px; }
.views button.on { background: var(--text); color: var(--bg); border-color: var(--text); font-weight: 600; }
.views .add { padding: 7px 10px; }
.views .add svg { width: 16px; height: 16px; }
.floor { margin-bottom: 28px; }
.floor-actions { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 10px; }
.floor-actions .hint { margin: 0; }
.invite { margin: -6px 2px 18px; }
.nothing { border-top: 1px solid var(--rule); padding-top: 18px; margin-bottom: 36px; }
.nothing h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.nothing p { margin: 0 0 14px; color: var(--text-2); max-width: 46ch; }
.go { font-weight: 600; }
.block-head h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; letter-spacing: -0.005em; }

/* A group is a tile that glows in the colour of its lamps */
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 10px; }
.tile { display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: var(--radius); padding: 12px 14px 12px 12px; transition: background-color var(--dur-3) var(--ease-out); }
.tile-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; border: 0; background: none; padding: 0; text-align: left; color: var(--text); }
.tile-main:hover { background: none; }
.glow { width: 40px; height: 40px; border-radius: 50%; flex: none; transition: background var(--dur-3) var(--ease-out), box-shadow var(--dur-3) var(--ease-out); }
.tile-text { display: flex; flex-direction: column; min-width: 0; }
.tile-name { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-sub { font-size: 13px; font-weight: 400; color: var(--text-2); }

.rooms { display: grid; gap: 22px; }
.room-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 2px 8px; }
.room-name { border: 0; background: none; padding: 0; font-size: 16px; font-weight: 600; color: var(--text); text-align: left; display: inline-flex; align-items: baseline; gap: 8px; }
.room-name:hover { background: none; }
.room-name:disabled { opacity: 1; }
.list { margin-bottom: 0; }
.lamp { gap: 10px; }
.lamp-btn { flex: 1; min-width: 0; border: 0; background: none; padding: 0; text-align: left; color: var(--text); font-weight: 400; }
.lamp-btn:hover { background: none; }
.lamp-btn .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot-glow { width: 18px; height: 18px; border-radius: 50%; flex: none; transition: background var(--dur-3) var(--ease-out), box-shadow var(--dur-3) var(--ease-out); }
.foot { font-size: 13px; color: var(--text-2); margin: 4px 2px 0; max-width: 60ch; }
@media (min-width: 1024px) {
  .rooms { grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 28px 40px; }
}
</style>
