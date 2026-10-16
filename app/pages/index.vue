<template>
  <div>
    <header class="page-head">
      <h1>Batteries</h1>
      <span v-if="d" class="sub"><span class="dot live" /> {{ time(d.now) }}</span>
    </header>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="d">
      <!-- Hero: one ring per battery, the combined level in the middle -->
      <section class="card hero rise">
        <div class="glow" :class="state" />
        <div class="card-head">
          <span class="eyebrow"><AppIcon name="battery" :style="{ color: stateColor }" /> {{ stateLabel }}</span>
          <span class="pill">{{ d.devices.length }} × STREAM Pro</span>
        </div>
        <SocRings :batteries="d.devices" :reserve="soc?.reserveSoc ?? 0" />
        <ul class="units">
          <li v-for="(b, i) in d.devices" :key="b.id">
            <span class="sw" :style="{ background: i === 0 ? 'var(--sys-green)' : 'var(--sys-teal)' }" />
            <div class="u-main">
              <div class="u-name">{{ b.name }} <span v-if="b.driver === 'mock'" class="muted">· simulated</span></div>
              <div class="u-meta">
                {{ b.powerW > 5 ? 'Charging' : b.powerW < -5 ? 'Discharging' : 'Idle' }}<template v-if="Math.abs(b.powerW) > 5"> · {{ watt(Math.abs(b.powerW)) }}</template>
                · {{ MODE_LABEL[b.mode ?? ''] ?? '–' }}
              </div>
            </div>
            <div class="u-pct">{{ b.soc == null ? '–' : Math.round(b.soc * 100) }}<small>%</small></div>
          </li>
        </ul>
      </section>

      <!-- Where the charge level has been and where the plan takes it -->
      <section class="card rise">
        <div class="card-head">
          <span class="eyebrow">Charge level</span>
          <span v-if="soc && projected != null" class="small muted">
            <span :class="projected >= soc.socNow ? 'pos' : ''">{{ Math.round(projected * 100) }}%</span> in 12 h
          </span>
        </div>
        <SocTimeline v-if="soc" :history="soc.history" :forecast="soc.forecast" :now="soc.now" :soc-now="soc.socNow" :reserve="soc.reserveSoc" />
        <div v-else class="skeleton" style="height: 210px" />
      </section>

      <div class="grid">
        <section class="card tile rise">
          <div class="label"><AppIcon name="leaf" class="ti" style="color: var(--sys-green)" /> Saved today</div>
          <div class="big" :class="savedToday >= 0 ? '' : 'neg'">{{ eur(savedTodayT) }}</div>
          <div class="small muted">vs exporting: {{ eur(d.today?.savingOpportunity ?? 0) }}</div>
        </section>
        <section class="card tile rise">
          <div class="label"><AppIcon name="euro" class="ti" style="color: var(--sys-blue)" /> Price now</div>
          <div class="big">{{ d.price ? eur(priceT, 3).replace('€', '').trim() : '–' }}<small class="unit">€/kWh</small></div>
          <div class="small muted">feed-in {{ d.price ? eur(d.price.feedIn, 3) : '–' }}</div>
        </section>
      </div>

      <section class="card rise">
        <div class="card-head"><span class="eyebrow">Energy flow</span><span class="small muted">{{ d.live?.houseSource ?? '' }}</span></div>
        <EnergyFlow :solar-w="d.live?.solarW ?? null" :grid-w="d.live?.gridW ?? null" :battery-w="totalPower" :house-w="houseW" />
      </section>

      <section class="card rise">
        <div class="card-head">
          <span class="eyebrow">Up next</span>
          <NuxtLink to="/plan" class="small">Full plan</NuxtLink>
        </div>
        <p v-if="d.site.override" class="banner">
          Override: <strong>{{ MODE_LABEL[d.site.override.mode] }}</strong> until {{ time(d.site.override.until) }}
        </p>
        <p v-if="d.site.controlMode === 'manual'" class="banner">Monitoring only: the plan is not sent to the batteries.</p>
        <ol class="next">
          <li v-for="p in nextRuns" :key="String(p.slotStart)">
            <span class="dot" :style="{ background: ACTION_COLOR[p.action] }" />
            <span class="n-time">{{ time(p.slotStart) }}<template v-if="p.end">–{{ time(p.end) }}</template></span>
            <span class="n-act">{{ MODE_LABEL[p.action] }}</span>
            <span class="n-price">{{ eur(p.price, 3) }}</span>
          </li>
        </ol>
      </section>

      <div class="row sources">
        <span class="pill"><span class="dot" :class="d.sources.pulse.connected ? 'ok' : ''" /> Tibber Pulse</span>
        <span v-for="i in d.sources.integrations" :key="i.provider" class="pill">
          <span class="dot" :class="i.status === 'ok' ? 'ok' : i.status === 'error' ? 'err' : ''" /> {{ i.provider }}
        </span>
      </div>
    </template>
    <template v-else-if="!error">
      <div class="skeleton" style="height: 420px; margin-bottom: 14px" />
      <div class="skeleton" style="height: 260px" />
    </template>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const d = ref<any>(null)
const soc = ref<any>(null)
const error = ref('')

const ACTION_COLOR: Record<string, string> = {
  charge_grid: 'var(--c-grid-charge)',
  discharge: 'var(--c-discharge)',
  self_use: 'var(--c-self-use)',
  solar_only: 'var(--c-hold)',
}

async function load() {
  try {
    const [dash, s] = await Promise.all([api('/api/dashboard'), api('/api/soc').catch(() => null)])
    d.value = dash
    if (s) soc.value = s
    error.value = ''
  } catch (e: any) {
    error.value = e?.data?.statusMessage || 'Could not load'
  }
}

const totalPower = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + b.powerW, 0))
const houseW = computed(() => (d.value?.live ? d.value.live.houseNetW + (d.value.live.solarW ?? 0) : null))
const state = computed(() => (totalPower.value > 5 ? 'charging' : totalPower.value < -5 ? 'discharging' : 'idle'))
const stateLabel = computed(() => ({ charging: `Charging · ${watt(totalPower.value)}`, discharging: `Powering the house · ${watt(-totalPower.value)}`, idle: 'Idle' })[state.value])
const stateColor = computed(() => ({ charging: 'var(--sys-green)', discharging: 'var(--sys-orange)', idle: 'var(--text-2)' })[state.value])
const savedToday = computed(() => d.value?.today?.savingNaive ?? 0)
const savedTodayT = useTweened(() => savedToday.value)
const priceT = useTweened(() => d.value?.price?.total ?? 0)
const projected = computed(() => soc.value?.forecast?.at(-1)?.soc ?? null)

// Merge consecutive slots with the same action into runs: "14:00–15:30 Discharge"
const nextRuns = computed(() => {
  const out: { slotStart: string; end?: string; action: string; price: number }[] = []
  for (const p of d.value?.next ?? []) {
    const last = out[out.length - 1]
    const end = new Date(new Date(p.slotStart).getTime() + 15 * 60_000).toISOString()
    if (last && last.action === p.action) {
      last.end = end
    } else out.push({ slotStart: p.slotStart, end, action: p.action, price: p.price })
  }
  return out.slice(0, 5)
})

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.hero { padding-bottom: 8px; }
.glow { position: absolute; inset: -40% -20% auto; height: 120%; pointer-events: none; opacity: 0.5; transition: background 1.2s; background: radial-gradient(closest-side, rgba(120, 120, 128, 0.18), transparent); }
.glow.charging { background: radial-gradient(closest-side, rgba(48, 209, 88, 0.2), transparent); animation: drift 8s ease-in-out infinite alternate; }
.glow.discharging { background: radial-gradient(closest-side, rgba(255, 159, 10, 0.18), transparent); animation: drift 8s ease-in-out infinite alternate; }
@keyframes drift { to { transform: translate3d(0, 6%, 0) scale(1.05); } }
.hero > *:not(.glow) { position: relative; }
.units { list-style: none; margin: 18px 0 0; padding: 0; }
.units li { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.units li + li { border-top: 0.5px solid var(--separator); }
.sw { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.u-main { flex: 1; min-width: 0; }
.u-name { font-size: 15px; font-weight: 600; }
.u-meta { font-size: 13px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.u-pct { font: 600 24px var(--font-rounded); font-variant-numeric: tabular-nums; }
.u-pct small { font-size: 14px; color: var(--text-2); font-weight: 500; }
.tile .label { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.ti { width: 16px; height: 16px; }
.tile .big { font-size: 28px; }
.unit { font: 500 13px var(--font); color: var(--text-2); margin-left: 4px; letter-spacing: 0; }
.banner { background: var(--fill-2); border-radius: 12px; padding: 10px 12px; font-size: 13px; margin: 0 0 10px; }
.next { list-style: none; margin: 0; padding: 0; }
.next li { display: grid; grid-template-columns: 10px auto 1fr auto; align-items: center; gap: 12px; padding: 11px 0; font-size: 15px; }
.next li + li { border-top: 0.5px solid var(--separator); }
.n-time { font-variant-numeric: tabular-nums; color: var(--text-2); }
.n-price { font-variant-numeric: tabular-nums; color: var(--text-2); font-size: 13px; }
.sources { justify-content: center; margin-top: 8px; }
</style>
