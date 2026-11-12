<template>
  <div>
    <div ref="box" class="plan" :class="{ editing, night: sky === 'night', raster: !isSvg }" :style="{ aspectRatio: ratio }">
      <img v-if="floor.plan" :src="floor.plan" alt="" draggable="false" @load="onLoad" />
      <div v-else class="no-plan">{{ m.lights.plan.noPlan }}</div>

      <!-- Light falling on the floor around each lamp that is on: the plan shows what the room looks like -->
      <div class="pools" aria-hidden="true">
        <span v-for="p in pins" v-show="p.lit" :key="`pool-${p.key}`" class="pool" :style="p.pool" />
      </div>

      <button
        v-for="p in pins" :key="p.key" type="button" class="pin" :class="[p.kind, { lit: p.lit, dragging: drag?.key === p.key, off: !p.reachable }]"
        :style="{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }" :aria-label="p.name"
        @pointerdown="down($event, p)" @click="click(p)"
      >
        <span class="disc" :style="p.glow"><span v-if="p.kind === 'group'" class="count">{{ p.count }}</span></span>
        <span class="pin-label">{{ p.name }}</span>
        <span v-if="editing" class="remove" role="button" :aria-label="m.lights.plan.remove(p.name)" @pointerdown.stop @click.stop="remove(p)">×</span>
      </button>
    </div>

    <!-- In edit mode: everything not on the plan yet, one tap puts it in the middle to drag from there -->
    <div v-if="editing" class="tray">
      <p class="label">{{ unplaced.length ? m.lights.plan.tray : m.lights.plan.allPlaced }}</p>
      <div class="chips">
        <button v-for="u in unplaced" :key="u.key" type="button" @click="place(u)">
          <span class="dot" :style="u.glow" />{{ u.name }}<small v-if="u.kind === 'group'">{{ u.count }}</small>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
type Lamp = { id: string; name: string; on: boolean; brightness: number; mirek: number | null; xy: Xy | null; reachable: boolean }
type Group = { id: string; kind: 'room' | 'zone'; name: string; groupedLightId: string | null; lightIds: string[] }
type Placement = { kind: 'light' | 'group'; id: string; x: number; y: number }
type Floor = { id: number; name: string; plan: string | null; placements: Placement[] }
type Pin = Placement & { key: string; name: string; count: number; lit: boolean; reachable: boolean; glow: Record<string, string>; pool: Record<string, string> }

const props = defineProps<{ floor: Floor; lights: Lamp[]; groups: Group[]; editing: boolean }>()
const emit = defineEmits<{ open: [Placement]; placements: [Placement[]] }>()
const { m } = useLocale()
const sky = useState<'day' | 'night'>('sky', () => 'day')

const box = ref<HTMLElement>()
const ratio = ref('4 / 3')
const isSvg = computed(() => !!props.floor.plan?.startsWith('data:image/svg'))
// Local copy while dragging, so the pin follows the finger before anything is saved
const local = ref<Placement[]>([...props.floor.placements])
watch(
  () => props.floor.placements,
  (p) => {
    if (!drag.value) local.value = [...p]
  },
)

function onLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) ratio.value = `${img.naturalWidth} / ${img.naturalHeight}`
}

const lightById = computed(() => new Map(props.lights.map((l) => [l.id, l])))
// Only groups with a grouped_light can be switched as one; the plan uses those
const groupById = computed(() => new Map(props.groups.filter((g) => g.groupedLightId).map((g) => [g.groupedLightId!, g])))

function describe(kind: 'light' | 'group', id: string) {
  const lamps = kind === 'light' ? [lightById.value.get(id)].filter((l): l is Lamp => !!l) : (groupById.value.get(id)?.lightIds ?? []).map((i) => lightById.value.get(i)).filter((l): l is Lamp => !!l)
  const name = kind === 'light' ? lightById.value.get(id)?.name : groupById.value.get(id)?.name
  if (!name) return null
  const lit = lamps.filter((l) => l.on)
  const bri = lit.length ? lit.reduce((s, l) => s + l.brightness, 0) / lit.length : 0
  const rgb = mixRgb(lit.map(lampRgb).filter((c): c is Rgb => !!c))
  const size = (kind === 'group' ? 26 : 16) + 22 * (bri / 100)
  return {
    name,
    count: lamps.length,
    lit: lit.length > 0,
    reachable: lamps.some((l) => l.reachable),
    glow: glow(rgb, bri),
    pool: (rgb
      ? { background: `radial-gradient(circle, ${rgbCss(rgb, 0.18 + 0.32 * (bri / 100))} 0%, ${rgbCss(rgb, 0)} 70%)`, width: `${size}%`, left: '0', top: '0' }
      : {}) as Record<string, string>,
  }
}

const pins = computed<Pin[]>(() =>
  local.value.flatMap((p) => {
    const d = describe(p.kind, p.id)
    if (!d) return []
    // The pool is sized in % of the plan's width and centred on the pin
    const pool = { ...d.pool, left: `${p.x * 100}%`, top: `${p.y * 100}%` }
    return [{ ...p, ...d, pool, key: `${p.kind}:${p.id}` }]
  }),
)

const unplaced = computed(() => {
  const on = new Set(local.value.map((p) => `${p.kind}:${p.id}`))
  // Own groups (zones) first, then rooms, then single lamps
  const groups = [...props.groups].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'zone' ? -1 : 1))
  const items = [
    ...groups.filter((g) => g.groupedLightId).map((g) => ({ kind: 'group' as const, id: g.groupedLightId! })),
    ...props.lights.map((l) => ({ kind: 'light' as const, id: l.id })),
  ]
  // Lamps in one of your own groups that is already on the plan are covered by that group
  const covered = new Set(
    local.value.flatMap((p) => {
      const g = p.kind === 'group' ? groupById.value.get(p.id) : undefined
      return g?.kind === 'zone' ? g.lightIds : []
    }),
  )
  return items.filter((i) => !on.has(`${i.kind}:${i.id}`) && !(i.kind === 'light' && covered.has(i.id))).flatMap((i) => {
    const d = describe(i.kind, i.id)
    return d ? [{ ...i, ...d, key: `${i.kind}:${i.id}` }] : []
  })
})

function save() {
  emit('placements', local.value.map(({ kind, id, x, y }) => ({ kind, id, x, y })))
}
function place(u: { kind: 'light' | 'group'; id: string }) {
  // A little off-centre each time, so new pins don't land on top of each other
  const n = local.value.length
  local.value = [...local.value, { kind: u.kind, id: u.id, x: 0.5 + ((n % 5) - 2) * 0.04, y: 0.5 + ((Math.floor(n / 5) % 3) - 1) * 0.05 }]
  save()
}
function remove(p: Pin) {
  local.value = local.value.filter((x) => !(x.kind === p.kind && x.id === p.id))
  save()
}

// Dragging a pin in edit mode; outside edit mode a tap opens the lamp
const drag = ref<{ key: string; moved: boolean } | null>(null)
let justDragged = false
function down(e: PointerEvent, p: Pin) {
  if (!props.editing) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  drag.value = { key: p.key, moved: false }
  const move = (ev: PointerEvent) => {
    const r = box.value!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
    drag.value!.moved = true
    local.value = local.value.map((q) => (q.kind === p.kind && q.id === p.id ? { ...q, x, y } : q))
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    if (drag.value?.moved) {
      justDragged = true
      save()
    }
    drag.value = null
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}
function click(p: Pin) {
  if (justDragged) return void (justDragged = false)
  if (!props.editing) emit('open', { kind: p.kind, id: p.id, x: p.x, y: p.y })
}
</script>

<style scoped>
.plan { position: relative; width: 100%; border-radius: var(--radius); background: var(--surface); overflow: hidden; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.plan img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
/* A photo or scan of a drawing is black on white: turn it around at night */
.plan.raster.night img { filter: invert(0.86) hue-rotate(180deg); opacity: 0.85; }
.plan.editing { outline: 2px dashed var(--muted); outline-offset: -2px; touch-action: none; }
.no-plan { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-2); font-size: 14px; padding: 16px; text-align: center; }

.pools { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen; }
.plan:not(.night) .pools { mix-blend-mode: multiply; opacity: 0.9; }
.pool { position: absolute; aspect-ratio: 1; border-radius: 50%; transform: translate(-50%, -50%); transition: width var(--dur-4) var(--ease-out), background var(--dur-4) var(--ease-out); }

.pin {
  position: absolute; transform: translate(-50%, -50%); border: 0; background: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--text); cursor: pointer; z-index: 1;
}
.pin:hover, .pin:active { background: none; }
.pin:active { transform: translate(-50%, -50%) scale(0.94); }
.disc { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; box-shadow: 0 0 0 2px var(--surface); transition: background var(--dur-3) var(--ease-out), box-shadow var(--dur-3) var(--ease-out), transform var(--dur-3) var(--spring); }
.pin.group .disc { width: 34px; height: 34px; }
.pin.off .disc { opacity: 0.5; }
.count { font-size: 12px; font-weight: 700; color: var(--text); text-shadow: 0 0 3px var(--surface); }
.pin.lit .count { color: #0b132b; text-shadow: none; }
.pin-label {
  font-size: 11px; font-weight: 600; line-height: 1.2; padding: 2px 6px; border-radius: 6px; white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis;
  background: color-mix(in srgb, var(--surface) 82%, transparent); color: var(--text);
}
.editing .pin { cursor: grab; touch-action: none; }
.pin.dragging { z-index: 3; cursor: grabbing; }
.pin.dragging .disc { transform: scale(1.25); }
.remove {
  position: absolute; top: -8px; right: -10px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
  background: var(--text); color: var(--bg); font-size: 14px; line-height: 1; font-weight: 700;
}
.pin.group .remove { right: -4px; }

.tray { margin-top: 14px; }
.tray .label { margin: 0 2px 8px; font-size: 14px; color: var(--text-2); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips button { border-radius: 999px; padding: 6px 12px 6px 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
.chips small { font-size: 12px; color: var(--text-2); }
.chips .dot { width: 14px; height: 14px; }
</style>
