<template>
  <div class="login">
    <img class="mark rise" src="/favicon.svg" alt="WattWise" width="84" height="84" />
    <h1 class="rise">{{ needsSetup ? 'Welcome to WattWise' : 'Welcome back' }}</h1>
    <p class="muted rise lede">{{ needsSetup ? 'First run: this creates the only account, with two simulated STREAM Pro batteries.' : 'Log in to see your batteries.' }}</p>
    <form class="rise" @submit.prevent="submit">
      <div class="list">
        <label class="list-row stack"><input v-model="email" type="email" placeholder="Email" autocomplete="username" required /></label>
        <label class="list-row stack"><input v-model="password" type="password" placeholder="Password" :autocomplete="needsSetup ? 'new-password' : 'current-password'" required minlength="8" /></label>
        <label v-if="needsSetup" class="list-row stack"><input v-model="setupCode" placeholder="Setup code" autocomplete="off" /></label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="busy">{{ busy ? '…' : needsSetup ? 'Create account' : 'Log in' }}</button>
    </form>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const { setToken } = useAuth()
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
    error.value = e?.data?.statusMessage || e?.statusMessage || 'Login failed'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.login { max-width: 380px; margin: 12vh auto 0; text-align: center; }
.mark { display: block; width: 84px; height: 84px; margin: 0 auto 18px; border-radius: 22px; box-shadow: 0 12px 40px rgba(48, 209, 88, 0.22); }
h1 { margin: 0 0 6px; font-size: 28px; }
.lede { font-size: 15px; margin: 0 0 24px; }
.list { text-align: left; }
.list-row.stack { padding: 4px 16px; }
.list-row.stack input { background: none; padding: 10px 0; border-radius: 0; box-shadow: none; }
button { width: 100%; padding: 14px; font-size: 17px; border-radius: 14px; }
.error { margin: 0 0 12px; }
</style>
