<template>
  <dialog ref="dlg" class="sheet" @close="emit('close')" @click.self="close">
    <form v-if="open" method="dialog" @submit.prevent="save">
      <h2 tabindex="-1" autofocus>{{ group ? m.lights.editTitle : m.lights.groupTitle }}</h2>

      <label class="field">
        <span>{{ m.lights.groupName }}</span>
        <input v-model="name" maxlength="32" :placeholder="m.lights.groupNamePlaceholder" required />
      </label>

      <p class="label spread"><span>{{ m.lights.pickLamps }}</span><span>{{ m.lights.picked(picked.size) }}</span></p>
      <div class="pick">
        <template v-for="r in byRoom" :key="r.name">
          <p class="room">{{ r.name }}</p>
          <div class="list">
            <label v-for="l in r.lights" :key="l.id" class="list-row">
              <span class="lead">
                <span class="dot-glow" :style="glow(lampRgb(l), l.on ? l.brightness : 0)" aria-hidden="true" />
                <span class="title">{{ l.name }}</span>
              </span>
              <input type="checkbox" class="check" :checked="picked.has(l.id)" @change="toggle(l.id)" />
            </label>
          </div>
        </template>
      </div>

      <p v-if="error" class="small neg">{{ error }}</p>
      <div class="actions">
        <button v-if="group" type="button" class="danger" :disabled="busy" @click="remove">{{ m.lights.deleteGroup }}</button>
        <span class="grow" />
        <button type="button" @click="close">{{ m.lights.cancel }}</button>
        <button type="submit" class="primary" :disabled="busy || !name.trim() || !picked.size">{{ busy ? m.lights.saving : m.lights.save }}</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
type Lamp = { id: string; name: string; on: boolean; brightness: number; mirek: number | null; xy: Xy | null }
type Group = { id: string; kind: 'room' | 'zone'; name: string; lightIds: string[] }

/** open: true for a new group; group: the zone to edit */
const props = defineProps<{ open: boolean; group: Group | null; lights: Lamp[]; rooms: Group[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const api = useApi()
const { m, serverText } = useLocale()

const dlg = ref<HTMLDialogElement>()
const name = ref('')
const picked = ref(new Set<string>())
const busy = ref(false)
const error = ref('')

// Lamps listed per room, so six spots in one room are easy to find; lamps in no room come last
const byRoom = computed(() => {
  const seen = new Set<string>()
  const out = props.rooms
    .map((r) => {
      const lights = props.lights.filter((l) => r.lightIds.includes(l.id))
      lights.forEach((l) => seen.add(l.id))
      return { name: r.name, lights }
    })
    .filter((r) => r.lights.length)
  const rest = props.lights.filter((l) => !seen.has(l.id))
  if (rest.length) out.push({ name: m.value.lights.noRoom, lights: rest })
  return out
})

function toggle(id: string) {
  const s = new Set(picked.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  picked.value = s
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const body = { name: name.value.trim(), lightIds: [...picked.value] }
    if (props.group) await api(`/api/lights/zones/${props.group.id}`, { method: 'PUT', body })
    else await api('/api/lights/zones', { method: 'POST', body })
    haptic('success')
    emit('saved')
    close()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.lights.failed
    haptic('error')
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.group || !confirm(m.value.lights.deleteConfirm(props.group.name))) return
  busy.value = true
  try {
    await api(`/api/lights/zones/${props.group.id}`, { method: 'DELETE' })
    emit('saved')
    close()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.lights.failed
  } finally {
    busy.value = false
  }
}

function close() {
  dlg.value?.close()
}

watch(
  () => props.open,
  (o) =>
    nextTick(() => {
      if (!o) return close()
      name.value = props.group?.name ?? ''
      picked.value = new Set(props.group?.lightIds ?? [])
      error.value = ''
      if (!dlg.value?.open) dlg.value?.showModal()
    }),
  { immediate: true },
)
</script>

<style scoped>
.sheet {
  border: 0; padding: 0; margin: auto auto 0; width: 100%; max-width: 520px; max-height: 92dvh;
  background: var(--surface); color: var(--text); border-radius: var(--radius) var(--radius) 0 0;
}
.sheet::backdrop { background: rgba(0, 0, 0, 0.4); }
form { padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
h2 { font-size: 19px; font-weight: 700; margin: 0 0 14px; outline: none; }
.label { margin: 6px 0 8px; font-size: 14px; color: var(--text-2); }
.room { font-size: 13px; font-weight: 600; color: var(--text-2); margin: 12px 2px 6px; }
.pick .list { background: var(--surface-2); margin: 0; }
.pick label.list-row { cursor: pointer; }
.dot-glow { width: 18px; height: 18px; border-radius: 50%; flex: none; }
.check { width: 22px; height: 22px; accent-color: var(--cta); flex: none; }
.small { font-size: 13px; margin: 12px 0 0; }
.neg { color: var(--alert); }
.actions { display: flex; gap: 10px; margin-top: 18px; align-items: center; }
.grow { flex: 1; }
@media (min-width: 560px) {
  .sheet { margin: auto; border-radius: var(--radius); }
}
</style>
