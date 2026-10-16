<template>
  <div style="max-width: 380px; margin: 10vh auto 0">
    <h1>{{ needsSetup ? 'Create your account' : 'Log in' }}</h1>
    <form class="card" @submit.prevent="submit">
      <label class="field"><span>Email</span><input v-model="email" type="email" autocomplete="username" required /></label>
      <label class="field"><span>Password</span><input v-model="password" type="password" :autocomplete="needsSetup ? 'new-password' : 'current-password'" required minlength="8" /></label>
      <label v-if="needsSetup" class="field"><span>Setup code</span><input v-model="setupCode" autocomplete="off" /></label>
      <p v-if="needsSetup" class="muted small">First run: this creates the only account, with two simulated STREAM Pro batteries.</p>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="busy" style="width: 100%">{{ needsSetup ? 'Create account' : 'Log in' }}</button>
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
