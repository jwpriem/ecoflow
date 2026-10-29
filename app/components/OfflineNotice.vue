<template>
  <!-- No answer from the server: say so, on any screen, unless the page already shows it (LoadError) -->
  <div v-if="offline" class="offline-notice note" role="alert">
    <strong>{{ m.load.unreachable }}</strong>
    <span>{{ m.load.checkConnection('') }}</span>
    <button type="button" class="plain" @click="retry">{{ m.common.tryAgain }}</button>
  </div>
</template>

<script setup lang="ts">
const offline = useOffline()
const { m } = useLocale()

// The browser knows before a request fails; back online, the next answer clears it
const down = () => (offline.value = true)
onMounted(() => {
  if (!navigator.onLine) down()
  window.addEventListener('offline', down)
})
onBeforeUnmount(() => window.removeEventListener('offline', down))

/** Start over: every page loads its data again */
const retry = () => reloadNuxtApp({ force: true })
</script>

<style scoped>
.offline-notice { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0 0 20px; }
.offline-notice span { flex-basis: 100%; }
.offline-notice .plain { padding: 0; font-size: 14px; font-weight: 600; }
</style>
