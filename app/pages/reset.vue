<template>
  <div class="login">
    <img class="mark" src="/favicon.svg" alt="WattsWise" width="64" height="64" />
    <template v-if="token">
      <h1>{{ m.reset.newTitle }}</h1>
      <p class="muted lede">{{ m.reset.newLede }}</p>
      <form @submit.prevent="confirm">
        <div class="list">
          <!-- The email is there for password managers, which save the new password under it -->
          <label class="list-row stack"><input v-model="email" type="email" :placeholder="m.login.email" :aria-label="m.login.email" autocomplete="username" required /></label>
          <label class="list-row stack">
            <input v-model="password" type="password" :placeholder="m.login.newPassword" :aria-label="m.login.password" autocomplete="new-password" required minlength="8" />
          </label>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="primary" type="submit" :disabled="busy">{{ busy ? m.reset.saving : m.reset.save }}</button>
      </form>
    </template>
    <template v-else>
      <h1>{{ m.reset.title }}</h1>
      <p class="muted lede">{{ m.reset.lede }}</p>
      <form v-if="!sent" @submit.prevent="request">
        <div class="list">
          <label class="list-row stack"><input v-model="email" type="email" :placeholder="m.login.email" :aria-label="m.login.email" autocomplete="username" required /></label>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="primary" type="submit" :disabled="busy">{{ busy ? m.reset.sending : m.reset.send }}</button>
      </form>
      <p v-else class="notice" role="status">{{ m.reset.sent }}</p>
    </template>
    <p class="other small"><NuxtLink to="/login">{{ m.reset.backToLogin }}</NuxtLink></p>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const route = useRoute()
const { setToken } = useAuth()
const { m, serverText } = useLocale()
const token = computed(() => String(route.query.token ?? ''))
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const sent = ref(false)

async function run(fn: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage || e?.statusMessage) || m.value.reset.failed
  } finally {
    busy.value = false
  }
}

const request = () =>
  run(async () => {
    await api('/api/auth/reset/request', { method: 'POST', body: { email: email.value } })
    sent.value = true
  })

// Saving ends every session, this browser's too: log in again with the new password
const confirm = () =>
  run(async () => {
    await api('/api/auth/reset/confirm', { method: 'POST', body: { token: token.value, password: password.value } })
    setToken(null)
    const res = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } }).catch(() => null)
    if (res) {
      setToken(res.token)
      await navigateTo('/app')
    } else await navigateTo('/login')
  })
</script>

<style scoped>
.login { max-width: 380px; margin: 12vh auto 0; text-align: center; }
.mark { display: block; width: 64px; height: 64px; margin: 0 auto 24px; border-radius: 14px; }
h1 { margin: 0 0 8px; font-size: 28px; font-stretch: 125%; letter-spacing: -0.02em; }
.lede { font-size: 15px; margin: 0 0 24px; }
.list { text-align: left; }
.list-row.stack { padding: 4px 16px; }
.list-row.stack input { border: 0; padding: 10px 0; border-radius: 0; }
button.primary { width: 100%; padding: 13px; font-size: 16px; }
.error, .notice { margin: 0 0 12px; }
.other { margin-top: 20px; }
</style>
