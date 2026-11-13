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
        <!-- The doorbell first and wide: it's the one you open when someone's at the door -->
        <div v-stagger class="cams" :class="{ single: state.cameras.length === 1 }">
          <CameraLive v-for="(c, i) in state.cameras" :key="c.id" :camera="c" :style="{ '--o': i }" />
        </div>
        <p class="foot">{{ m.security.foot }}</p>
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

type State = { connected: boolean; signedIn: boolean; cameras: Camera[] }

const api = useApi()
const { m } = useLocale()

const state = ref<State | null>(null)
const loadError = ref<any>(null)
const busy = ref(false)

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
onMounted(safeLoad)
</script>

<style scoped>
.nothing { border-top: 1px solid var(--rule); padding-top: 18px; margin-bottom: 36px; }
.nothing h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
.nothing p { margin: 0 0 14px; color: var(--text-2); max-width: 46ch; }
.go { font-weight: 600; }
.cams { display: grid; gap: 22px; margin-bottom: 18px; }
.foot { font-size: 13px; color: var(--text-2); margin: 4px 2px 0; max-width: 60ch; }
@media (min-width: 1024px) {
  .cams { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; align-items: start; }
  .cams.single { grid-template-columns: minmax(0, 760px); }
}
</style>
