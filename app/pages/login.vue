<template>
  <div class="login">
    <img class="mark" src="/favicon.svg" alt="WattsWise" width="64" height="64" />
    <h1>{{ needsSetup ? m.login.welcome : m.login.welcomeBack }}</h1>
    <p class="muted lede">{{ needsSetup ? m.login.firstRun : m.login.logInToSee }}</p>
    <form @submit.prevent="submit">
      <div class="list">
        <label class="list-row stack"><input v-model="email" type="email" :placeholder="m.login.email" :aria-label="m.login.email" autocomplete="username" required /></label>
        <label class="list-row stack"><input v-model="password" type="password" :placeholder="m.login.password" :aria-label="m.login.password" :autocomplete="needsSetup ? 'new-password' : 'current-password'" required minlength="8" /></label>
        <label v-if="needsSetup" class="list-row stack"><input v-model="setupCode" :placeholder="m.login.setupCode" :aria-label="m.login.setupCode" autocomplete="off" /></label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="busy">{{ busy ? (needsSetup ? m.login.creating : m.login.loggingIn) : needsSetup ? m.login.create : m.login.logIn }}</button>
    </form>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const { setToken } = useAuth()
const { m, serverText } = useLocale()
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const needsSetup = ref(false)
const setupCode = ref('')

onMounted(async () => {
  needsSetup.value = (await api<{ needsSetup: boolean }>('/api/auth/status').catch(() => ({ needsSetup: false }))).needsSetup
})

async function submit() {
  busy.value = true
  error.value = ''
  try {
    const res = await api<{ token: string }>(needsSetup.value ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value, setupCode: setupCode.value },
    })
    setToken(res.token)
    await navigateTo('/')
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage || e?.statusMessage) || m.value.login.failed
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.login { max-width: 380px; margin: 12vh auto 0; text-align: center; }
.mark { display: block; width: 64px; height: 64px; margin: 0 auto 24px; border-radius: 14px; }
h1 { margin: 0 0 8px; font-size: 28px; font-stretch: 125%; letter-spacing: -0.02em; }
.lede { font-size: 15px; margin: 0 0 24px; }
.list { text-align: left; }
.list-row.stack { padding: 4px 16px; }
.list-row.stack input { border: 0; padding: 10px 0; border-radius: 0; }
button { width: 100%; padding: 13px; font-size: 16px; }
.error { margin: 0 0 12px; }
</style>
