<template>
  <div v-stagger>
    <header class="page-head">
      <h1>{{ m.security.title }}</h1>
    </header>
    <LoadError v-if="loadError" :error="loadError" :what="m.security.what" :busy="busy" @retry="retryLoad" />

    <template v-else-if="state">
      <!-- Not connected, or connected but not signed in yet -->
      <section v-if="!state.signedIn" class="nothing">
        <h2>{{ state.connected ? m.security.signInTitle : m.security.connectTitle }}</h2>
        <p>{{ state.connected ? m.security.signInText : m.security.connectText }}</p>
        <NuxtLink to="/settings" class="go">{{ m.common.openSettings }}</NuxtLink>
      </section>
      <p v-else-if="!state.cameras.length" class="foot">{{ m.security.empty }}</p>

      <template v-else>
        <p v-if="state.lastRing" class="rang"><AppIcon name="bell" />{{ rang(state.lastRing.at) }}</p>
        <!-- The doorbell first: it's the one you open when someone's at the door. Wired cameras start live by themselves,
             battery ones wait behind Watch live (utils/cameras.ts). -->
        <div v-stagger class="cams" :class="{ single: state.cameras.length === 1 }">
          <!-- Whatever goes wrong in one camera stays in its tile: the page and the other camera keep going -->
          <NuxtErrorBoundary v-for="(c, i) in state.cameras" :key="c.id">
            <CameraLive :id="`cam-${c.id}`" :camera="c" :autostart="auto.includes(c.id)" :style="{ '--o': i }" />
            <template #error="{ clearError }">
              <article class="cam-error" :style="{ '--o': i }">
                <div class="frame">
                  <p>{{ m.security.failed }}</p>
                  <button type="button" class="primary" @click="clearError()">{{ m.common.tryAgain }}</button>
                </div>
                <header class="cap"><span class="name">{{ c.name }}</span></header>
              </article>
            </template>
          </NuxtErrorBoundary>
        </div>
        <p class="foot">{{ m.security.foot }}</p>
        <NuxtLink v-if="state.chime && me?.member === 'owner'" to="/settings#doorbell" class="to-chime">{{ m.security.chime }}<AppIcon name="chevron" /></NuxtLink>
      </template>
    </template>

    <template v-else>
      <div class="skeleton" style="aspect-ratio: 16 / 9; margin-bottom: 16px" />
      <div class="skeleton" style="aspect-ratio: 16 / 9" />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Camera } from '~/components/CameraLive.vue'

type State = { connected: boolean; signedIn: boolean; cameras: Camera[]; lastRing?: { at: string; cameraId: string; name: string | null } | null; chime?: boolean }

const api = useApi()
const { m } = useLocale()
const route = useRoute()
const { me } = useAuth()
const rang = useRingText()

const state = ref<State | null>(null)
const loadError = ref<any>(null)
const busy = ref(false)
const auto = computed(() => autostartCameras(state.value?.cameras ?? [], typeof route.query.live === 'string' ? route.query.live : null))

// The camera list barely changes, so one load per visit; a stream lives in its own card
async function safeLoad() {
  try {
    state.value = await api<State>('/api/security')
    loadError.value = null
  } catch (e) {
    if (!state.value) loadError.value = e
  }
}
async function retryLoad() {
  busy.value = true
  await safeLoad()
  busy.value = false
}
// From a notification (/security?live=<camera>): bring that camera into view
onMounted(async () => {
  await safeLoad()
  const live = route.query.live
  if (typeof live === 'string') nextTick(() => document.getElementById(`cam-${live}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
})
</script>

<style scoped>
.nothing { border-top: 1px solid var(--rule); padding-top: 18px; margin-bottom: 36px; }
.nothing h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.nothing p { margin: 0 0 14px; color: var(--text-2); max-width: 46ch; }
.go { font-weight: 600; }
.rang { display: flex; align-items: center; gap: 8px; margin: -8px 2px 16px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.rang svg { width: 18px; height: 18px; flex: none; }
.to-chime { display: inline-flex; align-items: center; gap: 4px; margin: 14px 2px 0; font-weight: 600; }
.to-chime svg { width: 16px; height: 16px; }
.cams { display: grid; gap: 22px; margin-bottom: 18px; }
.cam-error .frame {
  aspect-ratio: 16 / 9; border-radius: var(--radius); background: #0b132b; color: #f4eee6;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; text-align: center;
}
.cam-error .frame p { margin: 0; font-size: 14px; color: rgba(244, 238, 230, 0.78); }
.cam-error .frame button { border-radius: 999px; padding: 9px 18px; font-weight: 600; }
.cam-error .cap { padding: 10px 2px 0; font-size: 16px; font-weight: 600; }
.foot { font-size: 13px; color: var(--text-2); margin: 4px 2px 0; max-width: 60ch; }
@media (min-width: 1024px) {
  .cams { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; align-items: start; }
  .cams.single { grid-template-columns: minmax(0, 760px); }
}
</style>
