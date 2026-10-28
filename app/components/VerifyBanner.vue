<template>
  <!-- Until the address is confirmed: connecting Tibber, EcoFlow or SolarEdge is refused -->
  <div v-if="me && !me.emailVerified" class="verify note" role="status">
    <span>{{ m.verify.banner(me.email) }}</span>
    <button type="button" class="plain" :disabled="state === 'sending'" @click="resend">{{ state === 'sent' ? m.verify.sent : state === 'sending' ? m.verify.sending : m.verify.resend }}</button>
    <span v-if="error" class="error">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const { me, loadMe } = useAuth()
const { m, serverText } = useLocale()
const state = ref<'idle' | 'sending' | 'sent'>('idle')
const error = ref('')

async function resend() {
  state.value = 'sending'
  error.value = ''
  try {
    const r = await api<{ verified: boolean }>('/api/auth/verify/resend', { method: 'POST' })
    if (r.verified) await loadMe(true)
    state.value = 'sent'
  } catch (e: any) {
    state.value = 'idle'
    error.value = serverText(e?.data?.statusMessage) || e?.message
  }
}
</script>

<style scoped>
.verify { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0 0 20px; }
.verify .plain { padding: 0; font-size: 14px; }
.verify .error { flex-basis: 100%; }
</style>
