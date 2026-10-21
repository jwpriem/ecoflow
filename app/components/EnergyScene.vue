<template>
  <div class="scene-card">
    <div class="scene" :style="{ background: `linear-gradient(180deg, ${sky.top} 0%, ${sky.horizon} 78%)` }">
      <svg class="scene-art" viewBox="0 0 390 290" role="img" :aria-label="aria" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="scene-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#2d5236" />
            <stop offset="1" stop-color="#121a24" />
          </linearGradient>
        </defs>

        <!-- Sky: stars, moon and the real sun position over the house -->
        <g :opacity="sky.stars * 0.9" fill="#fff">
          <circle v-for="(s, i) in STARS" :key="i" :cx="s[0]" :cy="s[1]" :r="s[2]" />
        </g>
        <path :opacity="sky.moon" d="M318 40a16 16 0 1 0 0 30a12 12 0 1 1 0-30z" fill="#f2ecd6" />
        <g v-if="sun.altitude > -3">
          <circle :cx="sunX" :cy="sunY" r="28" :fill="sunColor" opacity="0.22" />
          <circle :cx="sunX" :cy="sunY" r="14" :fill="sunColor" />
        </g>
        <g fill="#fff" :opacity="0.5 - sky.darkness * 0.42">
          <ellipse cx="62" cy="120" rx="46" ry="20" />
          <ellipse cx="80" cy="104" rx="28" ry="20" />
          <ellipse cx="330" cy="126" rx="50" ry="20" />
        </g>
        <g stroke="rgba(255,255,255,0.4)" stroke-width="1.6" stroke-linecap="round" fill="none">
          <path d="M352 124V196M352 124 340 102M352 124H376M352 124 342 146" />
        </g>

        <!-- Landscape -->
        <path d="M180 192C250 168 330 166 390 178V240H180Z" fill="#7aa06a" />
        <path d="M0 178C60 186 120 196 210 206V240H0Z" fill="#4f8b60" />
        <ellipse cx="88" cy="200" rx="9" ry="30" fill="#3f7a52" />
        <ellipse cx="70" cy="216" rx="7" ry="18" fill="#2f5e40" />
        <path d="M24 236 32 192H36L44 236M20 202H48M25 214H43M29 224 39 230M39 224 29 230" stroke="#e5e5ea" stroke-width="2" stroke-linecap="round" fill="none" />
        <rect y="232" width="390" height="58" fill="url(#scene-ground)" />
        <path d="M0 240H188Q200 240 200 228V213M200 228Q200 240 212 240H390" stroke="#0e1712" stroke-width="2.5" fill="none" stroke-linecap="round" />

        <!-- House: roof with panels, wall, gable -->
        <polygon points="100,168 160,106 232,106 172,168" fill="#4b505c" />
        <polygon points="122,158 162,116 212,116 172,158" fill="#1f3a68" />
        <path d="M142 137H192M178 116 138 158M195 116 155 158" stroke="#5577ad" stroke-width="1" />
        <rect x="104" y="168" width="68" height="64" fill="#2a2c33" />
        <polygon points="172,168 232,106 292,168 292,232 172,232" fill="#353841" />

        <!-- Night falls over everything outside; the room stays lit -->
        <rect width="390" height="290" fill="#060b1c" :opacity="sky.darkness * 0.55" />
        <polygon points="236,120 286,170 286,229 236,229" fill="#cfc7bb" />
        <polygon points="236,120 286,170 236,170" fill="#ada395" />
        <polygon points="240,134 262,156 240,156" :fill="sky.horizon" />
        <circle cx="266" cy="190" r="22" fill="#f2ba30" :opacity="0.12 + sky.darkness * 0.4" />
        <path d="M266 186V228" stroke="#fff" stroke-width="1.5" />
        <polygon points="260,178 272,178 274,188 258,188" fill="#fff6d6" />
        <rect x="238" y="212" width="22" height="16" rx="2" fill="#9d958c" />
        <rect x="238" y="205" width="9" height="9" rx="1.5" fill="#8a8279" />

        <!-- Flows into the meter, then into the house -->
        <g v-for="l in links" :key="l.key">
          <path :d="l.d" class="wire" />
          <path
            v-if="l.active"
            :d="l.d"
            class="pulse"
            :class="{ still: !animate }"
            :style="{ stroke: l.color, animationDuration: `${l.dur}s`, animationDirection: l.forward ? 'normal' : 'reverse' }"
          />
        </g>
        <rect x="124" y="196" width="17" height="29" rx="3" fill="#e9edf2" />
        <rect x="129" y="193" width="7" height="3" rx="1" fill="#e9edf2" />
        <rect x="127" :y="222 - socH" width="11" :height="socH" rx="1.5" :fill="batteryColor" />
        <circle cx="200" cy="198" r="15" fill="#0b0d10" />
        <path d="M203 189 195 200H200.5L197 208 205.5 196H200Z" fill="none" stroke="var(--cheap)" stroke-width="1.8" stroke-linejoin="round" />
      </svg>

      <span class="where">{{ HOME_LOCATION.name }}, {{ sunLabel }}</span>

      <div v-for="c in chips" :key="c.key" class="chip" :style="c.pos">
        <span class="chip-icon" :style="{ background: c.active ? c.color : 'var(--surface-3)', color: c.active ? 'var(--bg)' : 'var(--text-2)' }"><AppIcon :name="c.icon" /></span>
        <span class="chip-text">
          <span class="chip-label">{{ c.label }}</span>
          <span class="chip-value">{{ c.value }}</span>
        </span>
      </div>
    </div>

    <div v-if="supply.length" class="supply">
      <div class="spread"><span class="s-title">House powered by</span><span class="small muted num">{{ fmt(houseW) }}</span></div>
      <div class="s-bar" role="img" :aria-label="`House powered by ${supply.map((s) => `${s.label} ${s.pct}%`).join(', ')}`">
        <div v-for="s in supply" :key="s.key" :style="{ width: `${s.pct}%`, background: s.color }" />
      </div>
      <div class="s-legend">
        <span v-for="s in supply" :key="s.key"><AppIcon :name="s.icon" :style="{ color: s.color }" />{{ s.label }} <b>{{ s.pct }}%</b></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ solarW: number | null; gridW: number | null; batteryW: number; houseW: number | null; soc?: number; animate?: boolean }>(),
  { soc: 0.6, animate: true },
)

const STARS = [[30, 30, 1.2], [74, 58, 1], [118, 22, 1.4], [160, 64, 1], [206, 34, 1.2], [250, 72, 1], [286, 20, 1.3], [356, 44, 1], [20, 96, 1], [232, 12, 1], [140, 94, 0.9], [372, 90, 1.1]] as const

// Redraw the sky every minute
const now = ref(new Date())
let timer: ReturnType<typeof setInterval>
onMounted(() => (timer = setInterval(() => (now.value = new Date()), 60_000)))
onBeforeUnmount(() => clearInterval(timer))

const sun = computed(() => sunPosition(now.value))
const sky = computed(() => skyFor(sun.value.altitude))
// East is left, west is right; the sun disappears behind the hills when it sets
const sunX = computed(() => Math.round(195 + Math.max(-1.2, Math.min(1.2, sun.value.hourAngle / 100)) * 160))
const sunY = computed(() => Math.round(196 - sun.value.altitude * 4.2))
// A low sun is warmer; fixed colors, so it never borrows a meaning from the price palette
const sunColor = computed(() => (sun.value.altitude < 6 ? '#f2913a' : '#f2ba30'))
const sunLabel = computed(() => {
  const { sunrise, sunset } = nextSunEvents(now.value)
  const hhmm = (d: Date) => d.toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })
  if (sun.value.altitude > -0.833) return sunset ? `sunset ${hhmm(sunset)}` : 'sun up'
  return sunrise ? `sunrise ${hhmm(sunrise)}` : 'sun down'
})

const fmt = (w: number | null) => (w == null ? '–' : Math.abs(w) >= 1000 ? `${(Math.abs(w) / 1000).toFixed(2)} kW` : `${Math.round(Math.abs(w))} W`)
// Same pace as the clean view: faster dots for more power
const dur = (w: number) => Math.max(0.5, 2.6 - (Math.min(3000, Math.abs(w)) / 3000) * 2.1)

const gridColor = 'var(--import)'
const batteryColor = computed(() => (props.batteryW < 0 ? 'var(--dear)' : 'var(--cheap)'))
const socH = computed(() => Math.max(2, Math.round(Math.max(0, Math.min(1, props.soc)) * 22)))

const links = computed(() => {
  const solar = props.solarW ?? 0
  const grid = props.gridW ?? 0
  const bat = props.batteryW
  const house = props.houseW ?? 0
  return [
    // Every path runs towards the meter; `forward` says whether energy flows that way
    { key: 'solar', d: 'M168 142C186 158 200 166 200 183', w: solar, forward: true, color: 'var(--sun)' },
    { key: 'battery', d: 'M143 210 185 201', w: bat, forward: bat < 0, color: batteryColor.value },
    { key: 'grid', d: 'M34 240H188Q200 240 200 228V214', w: grid, forward: grid > 0, color: gridColor },
    { key: 'house', d: 'M216 198H254', w: house, forward: true, color: 'var(--text)' },
  ].map((l) => ({ ...l, active: Math.abs(l.w) > 5, dur: dur(l.w) }))
})

const chips = computed(() => {
  const g = props.gridW ?? 0
  const b = props.batteryW
  return [
    { key: 'solar', icon: 'sun', label: 'Solar', value: fmt(props.solarW), color: 'var(--sun)', active: (props.solarW ?? 0) > 5, pos: { left: '36%', top: '14%' } },
    { key: 'battery', icon: 'battery', label: b > 5 ? 'Charging' : b < -5 ? 'Discharging' : 'Batteries', value: fmt(b), color: batteryColor.value, active: Math.abs(b) > 5, pos: { left: '2%', top: '30%' } },
    { key: 'grid', icon: 'grid', label: g > 5 ? 'Importing' : g < -5 ? 'Exporting' : 'Grid', value: fmt(props.gridW), color: gridColor, active: Math.abs(g) > 5, pos: { left: '2%', bottom: '3%' } },
    { key: 'house', icon: 'house', label: 'House', value: fmt(props.houseW), color: 'var(--text)', active: (props.houseW ?? 0) > 5, pos: { right: '2%', bottom: '3%' } },
  ]
})

// Where the house's power comes from right now: solar first, then the batteries, the grid covers the rest
const supply = computed(() => {
  const house = Math.max(0, props.houseW ?? 0)
  if (house < 5) return []
  const fromSolar = Math.min(Math.max(0, props.solarW ?? 0), house)
  const fromBattery = Math.min(Math.max(0, -props.batteryW), house - fromSolar)
  const fromGrid = Math.max(0, house - fromSolar - fromBattery)
  const pS = Math.round((fromSolar / house) * 100)
  const pB = Math.round((fromBattery / house) * 100)
  const pG = fromGrid > 0 ? 100 - pS - pB : 0
  return [
    { key: 'solar', label: 'Solar', icon: 'sun', pct: pS, color: 'var(--sun)' },
    { key: 'battery', label: 'Batteries', icon: 'battery', pct: pB, color: 'var(--dear)' },
    { key: 'grid', label: 'Grid', icon: 'grid', pct: pG, color: 'var(--import)' },
  ].filter((s) => s.pct > 0)
})

const aria = computed(() => chips.value.map((c) => `${c.label} ${c.value}`).join(', ') + `. ${HOME_LOCATION.name}, ${sunLabel.value}.`)
</script>

<style scoped>
/* The scene is an illustration with its own sky, so it keeps the night palette whatever the page
   does: chips, wires and their colors read the same over a blue noon sky and a starry one. */
.scene {
  position: relative; border-radius: var(--radius); overflow: hidden; aspect-ratio: 390 / 290; transition: background 2s;
  --bg: #16262e; --text: #e9f0f1; --text-2: #a2b4ba; --surface-3: #2f4753;
  --cheap: #4dbfa9; --dear: #ec6e9f; --sun: #f2ba30; --import: #79aedd;
  color: var(--text);
}
/* Only the illustration fills the scene; icons inside chips and the legend flow normally */
.scene-art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.wire { fill: none; stroke: rgba(255, 255, 255, 0.12); stroke-width: 2.5; stroke-linecap: round; }
.pulse { fill: none; stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 2 9; animation: flow linear infinite; }
.pulse.still { animation: none; }
@keyframes flow { to { stroke-dashoffset: -11; } }

.where, .chip {
  position: absolute;
  background: rgba(22, 38, 46, 0.74);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  box-shadow: inset 0 0 0 1px rgba(233, 240, 241, 0.12);
}
.where { top: 8px; right: 8px; padding: 3px 9px; border-radius: 4px; font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.chip { display: flex; align-items: center; gap: 7px; padding: 4px 10px 4px 5px; border-radius: 6px; }
.chip-icon { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none; transition: background 0.4s, color 0.4s; }
.chip-icon svg { width: 14px; height: 14px; display: block; stroke-width: 2.4; }
.chip-text { display: flex; flex-direction: column; line-height: 1.15; }
.chip-label { font-size: 11px; color: var(--text-2); }
.chip-value { font-size: 14px; font-weight: 600; font-stretch: 88%; font-variant-numeric: tabular-nums; }

.supply { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.s-title { font-size: 16px; font-weight: 600; }
.s-bar { display: flex; gap: 2px; height: 10px; border-radius: 2px; overflow: hidden; background: var(--fill); }
.s-bar > div { transition: width 0.8s var(--ease-out); }
.s-legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 14px; color: var(--text-2); }
.s-legend span { display: inline-flex; align-items: center; gap: 6px; }
.s-legend svg { width: 15px; height: 15px; display: block; flex: none; }
.s-legend b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
