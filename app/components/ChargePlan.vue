<template>
  <section class="plan" :aria-label="m.cars.plan.title">
    <h3>{{ m.cars.plan.title }}</h3>
    <p v-if="error" class="muted">{{ m.cars.plan.failed }}</p>
    <p v-else-if="!plan" class="muted">{{ m.cars.plan.loading }}</p>
    <p v-else-if="!plan.windows.length" class="muted">{{ m.cars.plan.none }}</p>
    <template v-else>
      <!-- The night at a glance: each charge block on a time axis, so pauses between blocks show -->
      <div class="timeline" aria-hidden="true">
        <div class="track">
          <span
            v-for="w in plan.windows" :key="w.start" class="block" :class="{ now: isNow(w) }"
            :style="{ left: `${pos(w.start)}%`, width: `${Math.max(pos(w.end) - pos(w.start), 0.8)}%` }"
          />
          <span v-if="nowPos != null" class="nowline" :style="{ left: `${nowPos}%` }" />
        </div>
        <div class="ticks">
          <span v-for="t in ticks" :key="t.ms" :style="{ left: `${t.pos}%` }">{{ t.label }}</span>
        </div>
      </div>

      <ol class="windows">
        <li v-for="(w, i) in plan.windows" :key="w.start" :class="{ now: isNow(w) }">
          <span class="when">
            <span v-if="showDay(i)" class="day">{{ dayLabel(w.start) }}</span>
            {{ time(w.start) }}–{{ time(w.end) }}
            <span class="dur">{{ duration(w) }}</span>
          </span>
          <span class="soc">{{ socText(w) }}</span>
          <span class="cost">{{ kwh(w.energyKwh, 1) }} · {{ eur(w.cost) }}<template v-if="w.energyKwh > 0"> · {{ m.cars.plan.perKwh(eur(w.cost / w.energyKwh)) }}</template></span>
        </li>
      </ol>
      <p class="total">{{ m.cars.plan.total(plan.windows.length, kwh(plan.energyKwh, 1), eur(plan.cost)) }}</p>
      <p v-if="plan.netCost != null && plan.ereEurPerKwh" class="net">
        <span>{{ m.cars.plan.net(eur(plan.ereEurPerKwh * plan.energyKwh), eur(plan.ereEurPerKwh)) }}</span>
        <strong>{{ eur(plan.netCost) }}</strong>
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
interface Window { start: string; end: string; fromSoc: number | null; toSoc: number | null; energyKwh: number; cost: number }
const props = defineProps<{ plan: { windows: Window[]; energyKwh: number; cost: number; ereEurPerKwh?: number | null; netCost?: number | null } | null; error?: boolean }>()
const { m } = useLocale()

const HOUR = 3_600_000
const ms = (iso: string) => new Date(iso).getTime()

// The axis runs from the whole hour before the first block (or now) to the whole hour after the last
const span = computed(() => {
  const w = props.plan?.windows ?? []
  if (!w.length) return null
  const from = Math.floor(Math.min(ms(w[0]!.start), Date.now()) / HOUR) * HOUR
  const to = Math.ceil(ms(w.at(-1)!.end) / HOUR) * HOUR
  return { from, to: Math.max(to, from + HOUR) }
})
const pos = (iso: string) => {
  const s = span.value!
  return Math.min(100, Math.max(0, ((ms(iso) - s.from) / (s.to - s.from)) * 100))
}
const nowPos = computed(() => {
  const s = span.value
  if (!s || Date.now() < s.from || Date.now() > s.to) return null
  return ((Date.now() - s.from) / (s.to - s.from)) * 100
})
// A label every 2, 3 or 6 hours, so about five fit on a phone
const ticks = computed(() => {
  const s = span.value
  if (!s) return []
  const hours = (s.to - s.from) / HOUR
  const step = hours <= 10 ? 2 : hours <= 18 ? 3 : 6
  const out: { ms: number; pos: number; label: string }[] = []
  for (let t = s.from; t <= s.to; t += HOUR) {
    const h = new Date(t).getHours()
    if (h % step) continue
    out.push({ ms: t, pos: ((t - s.from) / (s.to - s.from)) * 100, label: `${String(h).padStart(2, '0')}` })
  }
  return out
})

const isNow = (w: Window) => ms(w.start) <= Date.now() && Date.now() < ms(w.end)
const socText = (w: Window) => (w.fromSoc != null && w.toSoc != null ? `${w.fromSoc}% → ${w.toSoc}%` : w.toSoc != null ? `→ ${w.toSoc}%` : '')
function duration(w: Window) {
  const min = Math.round((ms(w.end) - ms(w.start)) / 60_000)
  return m.value.cars.plan.duration(Math.floor(min / 60), min % 60)
}

const dayOf = (iso: string) => new Date(iso).setHours(0, 0, 0, 0)
// Only name the day when it differs from the block before
const showDay = (i: number) => i === 0 || dayOf(props.plan!.windows[i]!.start) !== dayOf(props.plan!.windows[i - 1]!.start)
function dayLabel(iso: string) {
  const days = Math.round((dayOf(iso) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return m.value.day.today
  if (days === 1) return m.value.day.tomorrow
  return new Date(iso).toLocaleDateString(m.value.dateLocale, { weekday: 'long' })
}
</script>

<style scoped>
.plan { margin-top: 22px; }
.plan h3 { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
.muted { margin: 0; font-size: 14px; color: var(--text-2); }

.timeline { margin: 0 0 12px; }
.track { position: relative; height: 22px; border-radius: 4px; background: var(--rule); overflow: hidden; }
.block { position: absolute; top: 0; bottom: 0; background: var(--cheap); opacity: 0.55; border-radius: 3px; }
.block.now { opacity: 1; }
.nowline { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: var(--text); }
.ticks { position: relative; height: 18px; margin-top: 4px; font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ticks span { position: absolute; transform: translateX(-50%); }
.ticks span:first-child { transform: none; }
.ticks span:last-child:not(:first-child) { transform: translateX(-100%); }

.windows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
.windows li { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 0; border-bottom: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
.when { font-weight: 600; }
.day { color: var(--text-2); font-weight: 400; margin-right: 4px; }
.dur { color: var(--text-2); font-weight: 400; font-size: 13px; margin-left: 6px; }
.soc { text-align: right; font-weight: 600; }
.cost { grid-column: 1 / -1; font-size: 13px; color: var(--text-2); }
.now .when, .now .soc { color: var(--cheap); }
.total { margin: 8px 0 0; font-size: 13px; color: var(--text-2); }
.net { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--rule); font-size: 14px; }
.net span { color: var(--text-2); }
.net strong { font-weight: 650; font-variant-numeric: tabular-nums; }
</style>
