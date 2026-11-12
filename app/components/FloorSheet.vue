<template>
  <dialog ref="dlg" class="sheet" @close="emit('close')" @click.self="close">
    <form v-if="open" method="dialog" @submit.prevent="save">
      <h2 tabindex="-1" autofocus>{{ floor ? m.lights.plan.editFloor : m.lights.plan.addFloor }}</h2>

      <label class="field">
        <span>{{ m.lights.plan.floorName }}</span>
        <input v-model="name" maxlength="40" :placeholder="m.lights.plan.floorPlaceholder" required />
      </label>

      <p class="label">{{ m.lights.plan.planImage }}</p>
      <label class="drop">
        <img v-if="plan" :src="plan" alt="" />
        <span v-else class="small muted">{{ m.lights.plan.pick }}</span>
        <input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" @change="pick" />
      </label>
      <p class="small muted">{{ busyRead ? m.lights.plan.reading : m.lights.plan.planHelp }}</p>

      <p v-if="error" class="small neg">{{ error }}</p>
      <div class="actions">
        <button v-if="floor" type="button" class="danger" :disabled="busy" @click="remove">{{ m.lights.plan.deleteFloor }}</button>
        <span class="grow" />
        <button type="button" @click="close">{{ m.lights.cancel }}</button>
        <button type="submit" class="primary" :disabled="busy || busyRead || !name.trim()">{{ busy ? m.lights.saving : m.lights.save }}</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
type Floor = { id: number; name: string; plan: string | null }

const props = defineProps<{ open: boolean; floor: Floor | null }>()
const emit = defineEmits<{ close: []; saved: [number | null] }>()
const api = useApi()
const { m, serverText } = useLocale()

const dlg = ref<HTMLDialogElement>()
const name = ref('')
const plan = ref<string | null>(null)
const changed = ref(false)
const busy = ref(false)
const busyRead = ref(false)
const error = ref('')

const readAsDataUrl = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })

/** An SVG goes as it is; a photo or screenshot is scaled down to 2000 px so it stays small */
async function shrink(file: File): Promise<string> {
  if (file.type === 'image/svg+xml') return readAsDataUrl(file)
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

async function pick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  error.value = ''
  busyRead.value = true
  try {
    plan.value = await shrink(file)
    changed.value = true
  } catch {
    error.value = m.value.lights.plan.badImage
  } finally {
    busyRead.value = false
  }
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const body = { name: name.value.trim(), ...(changed.value ? { plan: plan.value } : {}) }
    let id = props.floor?.id ?? null
    if (props.floor) await api(`/api/lights/floors/${props.floor.id}`, { method: 'PUT', body })
    else id = (await api<{ id: number }>('/api/lights/floors', { method: 'POST', body })).id
    haptic('success')
    emit('saved', id)
    close()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.lights.failed
    haptic('error')
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.floor || !confirm(m.value.lights.plan.deleteConfirm(props.floor.name))) return
  busy.value = true
  try {
    await api(`/api/lights/floors/${props.floor.id}`, { method: 'DELETE' })
    emit('saved', null)
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
      name.value = props.floor?.name ?? ''
      plan.value = props.floor?.plan ?? null
      changed.value = false
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
.label { margin: 6px 2px 8px; font-size: 14px; color: var(--text-2); }
.drop { position: relative; display: grid; place-items: center; min-height: 140px; max-height: 260px; border: 1px dashed var(--muted); border-radius: var(--radius-sm); overflow: hidden; cursor: pointer; background: var(--surface-2); }
.drop img { max-width: 100%; max-height: 258px; object-fit: contain; }
.drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.small { font-size: 13px; margin: 8px 2px 0; }
.muted { color: var(--text-2); }
.neg { color: var(--alert); }
.actions { display: flex; gap: 10px; margin-top: 18px; align-items: center; }
.grow { flex: 1; }
@media (min-width: 560px) {
  .sheet { margin: auto; border-radius: var(--radius); }
}
</style>
