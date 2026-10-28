<template>
  <!-- The batteries at a glance from every page: each STREAM unit stands upright, filled to its charge.
       Home already says all of this in full, so the rail leaves it out there. -->
  <NuxtLink v-if="shown" to="/" class="now" :aria-label="m.home.batteriesPct(pct)">
    <div class="units" aria-hidden="true">
      <div v-for="b in d.devices" :key="b.id" class="unit" :style="{ flexGrow: b.capacityWh }">
        <div class="unit-fill" :class="unitState(b)" :style="{ height: `${(b.soc ?? 0) * 100}%` }" />
      </div>
    </div>
    <div class="read">
      <span class="pct">{{ pct }}<small>%</small></span>
      <span class="power" :class="state">
        <template v-if="state === 'charging'">+{{ watt(power) }}</template>
        <template v-else-if="state === 'discharging'">−{{ watt(-power) }}</template>
        <template v-else>{{ m.home.idle }}</template>
      </span>
    </div>
    <p v-if="d.price" class="price">
      <span>{{ m.home.priceNow }}</span>
      <b>{{ num(d.price.total * 100, 1) }} ct</b>
    </p>
  </NuxtLink>
</template>

<script setup lang="ts">
const api = useApi()
const { m } = useLocale()
const route = useRoute()
// Home writes its dashboard here; on other pages the rail fetches its own, and only on a large screen
const d = useState<any>('dashboard', () => null)
const wide = ref(false)

const shown = computed(() => wide.value && route.path !== '/' && d.value?.devices?.length)
const capacity = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + b.capacityWh, 0))
const pct = computed(() => (capacity.value ? Math.round(((d.value?.devices ?? []).reduce((s: number, b: any) => s + (b.soc ?? 0) * b.capacityWh, 0) / capacity.value) * 100) : 0))
const power = computed(() => (d.value?.devices ?? []).reduce((s: number, b: any) => s + b.powerW, 0))
const unitState = (b: any) => (b.powerW > 5 ? 'charging' : b.powerW < -5 ? 'discharging' : 'idle')
const state = computed(() => unitState({ powerW: power.value }))

async function refresh() {
  if (!wide.value || route.path === '/' || document.visibilityState !== 'visible') return
  try {
    d.value = await api('/api/dashboard')
  } catch {
    // The rail is a glance: keep the last reading, the page itself reports a server that's down
  }
}

let timer: ReturnType<typeof setInterval>
let mq: MediaQueryList
const onWide = () => {
  wide.value = mq.matches
  refresh()
}
onMounted(() => {
  mq = matchMedia('(min-width: 1024px)')
  mq.addEventListener('change', onWide)
  onWide()
  timer = setInterval(refresh, 60_000)
})
watch(() => route.path, (p, prev) => prev === '/' || refresh())
onBeforeUnmount(() => {
  clearInterval(timer)
  mq?.removeEventListener('change', onWide)
})
</script>

<style scoped>
.now {
  display: grid; grid-template-columns: auto 1fr; gap: 14px 14px; align-items: end;
  padding: 16px 12px 0; border-top: 1px solid var(--rule); color: inherit; text-decoration: none;
}
.units { display: flex; gap: 4px; width: 46px; height: 64px; }
.unit { flex: 1 1 0; min-width: 0; position: relative; border: 1.5px solid var(--text); border-radius: 4px; padding: 2px; display: flex; align-items: flex-end; }
.unit-fill { width: 100%; background: var(--text); border-radius: 1.5px; transition: height 1s var(--ease-out); }
/* The top edge shows which way the energy goes, like the leading edge of the pack on Home */
.unit-fill.charging { box-shadow: inset 0 3px 0 var(--cheap); }
.unit-fill.discharging { box-shadow: inset 0 3px 0 var(--dear); }
.read { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pct { font-size: 32px; line-height: 1; font-weight: 650; font-stretch: 75%; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.pct small { font-size: 16px; font-weight: 500; color: var(--text-2); margin-left: 1px; }
.power { font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; font-stretch: 88%; white-space: nowrap; }
.power.charging { color: var(--cheap); }
.power.discharging { color: var(--dear); }
.price { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 0; font-size: 13px; color: var(--text-2); }
.price b { color: var(--text); font-weight: 600; font-size: 15px; font-stretch: 88%; font-variant-numeric: tabular-nums; }
.now:hover .pct { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; text-decoration-color: var(--muted); }
</style>
