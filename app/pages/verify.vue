<template>
  <div class="login">
    <img class="mark" src="/favicon.svg" alt="WattsWise" width="64" height="64" />
    <h1>{{ state === 'ok' ? m.verify.doneTitle : state === 'failed' ? m.verify.failedTitle : m.verify.checking }}</h1>
    <p v-if="state === 'ok'" class="muted lede">{{ m.verify.doneLede }}</p>
    <p v-else-if="state === 'failed'" class="muted lede">{{ error || m.verify.failedLede }}</p>
    <NuxtLink v-if="state !== 'busy'" :to="loggedIn ? (state === 'ok' ? '/settings' : '/app') : '/login'" class="button">
      {{ loggedIn ? (state === 'ok' ? m.verify.toSettings : m.verify.toApp) : m.verify.toLogin }}
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const route = useRoute()
const { loggedIn, loadMe } = useAuth()
const { m, serverText } = useLocale()
const state = ref<'busy' | 'ok' | 'failed'>('busy')
const error = ref('')

onMounted(async () => {
  try {
    await api('/api/auth/verify', { method: 'POST', body: { token: String(route.query.token ?? '') } })
    state.value = 'ok'
    if (loggedIn.value) await loadMe(true).catch(() => undefined)
  } catch (e: any) {
    state.value = 'failed'
    error.value = serverText(e?.data?.statusMessage)
  }
})
</script>

<style scoped>
.login { max-width: 380px; margin: 12vh auto 0; text-align: center; }
.mark { display: block; width: 64px; height: 64px; margin: 0 auto 24px; border-radius: 14px; }
h1 { margin: 0 0 8px; font-size: 28px; font-stretch: 125%; letter-spacing: -0.02em; }
.lede { font-size: 15px; margin: 0 0 24px; }
/* A link that looks like the primary button */
.button { display: block; padding: 13px; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 12px; background: var(--text); color: var(--bg); }
</style>
