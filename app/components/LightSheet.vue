<template>
  <dialog ref="dlg" class="sheet" @close="emit('close')" @click.self="close">
    <div v-if="target" class="body">
      <header class="head">
        <span class="glow" :style="glowStyle" aria-hidden="true" />
        <div class="names">
          <h2 tabindex="-1" autofocus>{{ target.name }}</h2>
          <p class="small muted">{{ subtitle }}</p>
        </div>
        <label class="switch">
          <input type="checkbox" :checked="target.on" :aria-label="m.lights.toggle(target.name)" @change="emit('change', { on: ($event.target as HTMLInputElement).checked })" />
          <span />
        </label>
      </header>

      <template v-if="supports.dim">
        <p class="label spread"><span>{{ m.lights.brightness }}</span><span class="num">{{ target.on ? `${Math.round(target.brightness)}%` : '–' }}</span></p>
        <input
          class="range bright" type="range" min="1" max="100" step="1" :value="target.on ? target.brightness : 1"
          :style="{ '--tint': tintCss }" :aria-label="m.lights.brightness"
          @input="emit('change', { brightness: Number(($event.target as HTMLInputElement).value) })"
        />
      </template>

      <template v-if="supports.temperature || supports.color">
        <Segmented v-if="supports.temperature && supports.color" v-model="tab" class="tabs-row" full :options="[{ value: 'white', label: m.lights.white }, { value: 'color', label: m.lights.color }]" />

        <template v-if="tab === 'white' && supports.temperature">
          <p class="label spread"><span>{{ m.lights.warmCool.warm }}</span><span>{{ m.lights.warmCool.cool }}</span></p>
          <!-- Left is warm: the slider runs from high mirek to low -->
          <input
            class="range temp" type="range" :min="0" :max="347" step="1" :value="500 - (mirek ?? 370)" :aria-label="m.lights.white"
            @input="emit('change', { mirek: 500 - Number(($event.target as HTMLInputElement).value) })"
          />
          <div class="chips">
            <button v-for="w in WHITE_PRESETS" :key="w.key" type="button" :class="{ on: mirek != null && Math.abs(mirek - w.mirek) < 12 }" @click="emit('change', { mirek: w.mirek })">
              <span class="swatch" :style="{ background: rgbCss(mirekToRgb(w.mirek)) }" />{{ m.lights.whites[w.key] }}
            </button>
          </div>
        </template>

        <template v-else-if="supports.color">
          <div class="swatches">
            <button
              v-for="(c, i) in COLOR_PRESETS" :key="i" type="button" class="swatch-btn" :style="{ background: rgbCss(c) }"
              :aria-label="rgbToHex(c)" @click="pickRgb(c)"
            />
            <label class="swatch-btn custom" :aria-label="m.lights.otherColor">
              <input type="color" :value="pickerValue" @input="pickHex(($event.target as HTMLInputElement).value)" />
            </label>
          </div>
        </template>
      </template>

      <!-- A group: its lamps, each to switch on its own -->
      <template v-if="target.kind === 'group' && members.length">
        <p class="label">{{ m.lights.inGroup }}</p>
        <div class="list members">
          <div v-for="l in members" :key="l.id" class="list-row">
            <div class="lead">
              <span class="dot-glow" :style="dotStyle(l)" aria-hidden="true" />
              <span class="title">{{ l.name }}<span v-if="!l.reachable" class="small muted"> · {{ m.lights.unreachable }}</span></span>
            </div>
            <label class="switch">
              <input type="checkbox" :checked="l.on" :aria-label="m.lights.toggle(l.name)" @change="emit('member', l.id, { on: ($event.target as HTMLInputElement).checked })" />
              <span />
            </label>
          </div>
        </div>
      </template>

      <div class="actions">
        <template v-if="target.kind === 'group' && target.zone">
          <button type="button" @click="emit('edit')">{{ m.lights.editGroup }}</button>
        </template>
        <span class="grow" />
        <button type="button" class="primary" @click="close">{{ m.lights.close }}</button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
export interface SheetTarget {
  kind: 'light' | 'group'
  id: string
  name: string
  on: boolean
  brightness: number
  /** Only for a group: whether it's one of ours (a Hue zone), which can be edited */
  zone?: boolean
  lightIds: string[]
}
type Lamp = { id: string; name: string; on: boolean; brightness: number; mirek: number | null; xy: Xy | null; reachable: boolean; supports: { dim: boolean; temperature: boolean; color: boolean } }
export type LightChange = { on?: boolean; brightness?: number; mirek?: number; xy?: Xy }

const props = defineProps<{ target: SheetTarget | null; lights: Lamp[] }>()
const emit = defineEmits<{ close: []; change: [LightChange]; member: [string, LightChange]; edit: [] }>()
const { m } = useLocale()

const dlg = ref<HTMLDialogElement>()
const tab = ref<'white' | 'color'>('white')

const members = computed(() => (props.target ? props.lights.filter((l) => props.target!.lightIds.includes(l.id)) : []))
// A group can do what any of its lamps can
const supports = computed(() => ({
  dim: members.value.some((l) => l.supports.dim),
  temperature: members.value.some((l) => l.supports.temperature),
  color: members.value.some((l) => l.supports.color),
}))
// The white tone shown: that of the first lamp that is on in white
const mirek = computed(() => (members.value.find((l) => l.on && l.mirek != null) ?? members.value.find((l) => l.mirek != null))?.mirek ?? null)
const tint = computed(() => mixRgb(members.value.map(lampRgb).filter((c): c is Rgb => !!c)))
const tintCss = computed(() => (tint.value ? rgbCss(tint.value) : 'var(--muted)'))
const glowStyle = computed(() => glow(tint.value, props.target?.on ? props.target.brightness : 0))
const pickerValue = computed(() => (tint.value ? rgbToHex(tint.value) : '#ffb54d'))
const subtitle = computed(() => {
  const t = props.target!
  if (t.kind === 'light') return members.value[0]?.reachable === false ? m.value.lights.unreachable : t.on ? `${Math.round(t.brightness)}%` : m.value.lights.lampsOn(0, 1)
  return `${m.value.lights.lamps(members.value.length)} · ${m.value.lights.lampsOn(members.value.filter((l) => l.on).length, members.value.length)}`
})

const dotStyle = (l: Lamp) => glow(lampRgb(l), l.on ? l.brightness : 0)

function pickRgb(c: Rgb) {
  emit('change', { xy: rgbToXy(c) })
}
function pickHex(hex: string) {
  const c = hexToRgb(hex)
  if (c) pickRgb(c)
}

function close() {
  dlg.value?.close()
}

watch(
  () => props.target?.id,
  (id) =>
    nextTick(() => {
      if (!id) return close()
      // Open on the tab that matches what the lamps do now
      const colored = members.value.some((l) => l.on && l.mirek == null && l.xy)
      tab.value = colored && supports.value.color ? 'color' : supports.value.temperature ? 'white' : 'color'
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
.body { padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
.head { display: flex; align-items: center; gap: 14px; }
.names { flex: 1; min-width: 0; }
h2 { font-size: 19px; font-weight: 700; margin: 0; outline: none; }
.small { font-size: 13px; margin: 2px 0 0; }
.label { margin: 20px 0 10px; font-size: 14px; color: var(--text-2); }
.glow { width: 44px; height: 44px; border-radius: 50%; flex: none; transition: background var(--dur-3) var(--ease-out), box-shadow var(--dur-3) var(--ease-out); }

/* Sliders: a thick track that shows what it sets */
.range { -webkit-appearance: none; appearance: none; width: 100%; height: 36px; border-radius: 18px; padding: 0; border: 0; margin: 0; cursor: pointer; }
.range.bright { background: linear-gradient(90deg, var(--fill), var(--tint)); }
.range.temp { background: linear-gradient(90deg, rgb(255 147 41), rgb(255 228 206), rgb(201 218 255)); }
.range::-webkit-slider-thumb { -webkit-appearance: none; width: 30px; height: 30px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); border: 0; transition: transform var(--dur-2) var(--spring); }
.range:active::-webkit-slider-thumb { transform: scale(1.12); }
.range::-moz-range-thumb { width: 30px; height: 30px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); border: 0; }
.range:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

.tabs-row { margin-top: 22px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.chips button { border-radius: 999px; padding: 6px 12px 6px 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
.chips button.on { background: var(--text); color: var(--bg); border-color: var(--text); }
.swatch { width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }

.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 10px; margin-top: 16px; }
.swatch-btn { aspect-ratio: 1; border-radius: 50%; border: 0; padding: 0; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); cursor: pointer; }
.swatch-btn.custom { position: relative; background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); }
.swatch-btn.custom input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; border: 0; padding: 0; }

.members { background: var(--surface-2); margin: 0; }
.dot-glow { width: 18px; height: 18px; border-radius: 50%; flex: none; }
.actions { display: flex; gap: 10px; margin-top: 22px; align-items: center; }
.grow { flex: 1; }
@media (min-width: 560px) {
  .sheet { margin: auto; border-radius: var(--radius); }
}
</style>
