<template>
  <div class="login">
    <img class="mark" src="/favicon.svg" alt="WattsWise" width="64" height="64" />
    <h1>{{ signingUp ? m.login.welcome : m.login.welcomeBack }}</h1>
    <p class="muted lede">{{ signingUp ? m.login.signupLede : m.login.logInToSee }}</p>
    <form @submit.prevent="submit">
      <div class="list">
        <label class="list-row stack"><input v-model="email" type="email" :placeholder="m.login.email" :aria-label="m.login.email" autocomplete="username" required /></label>
        <label class="list-row stack">
          <input
            v-model="password" type="password" :placeholder="signingUp ? m.login.newPassword : m.login.password" :aria-label="m.login.password"
            :autocomplete="signingUp ? 'new-password' : 'current-password'" required minlength="8"
          />
        </label>
        <label v-if="signingUp" class="list-row terms"><input v-model="acceptTerms" type="checkbox" required /><span>{{ m.login.acceptTerms }}</span></label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <button class="primary" type="submit" :disabled="busy">{{ busy ? (signingUp ? m.login.creating : m.login.loggingIn) : signingUp ? m.login.create : m.login.logIn }}</button>
    </form>
    <p v-if="signupOpen" class="other small muted">
      {{ signingUp ? m.login.haveAccount : m.login.noAccount }}
      <button type="button" class="plain" @click="toggle">{{ signingUp ? m.login.logIn : m.login.create }}</button>
    </p>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const { setToken } = useAuth()
const { m, locale, serverText } = useLocale()
const email = ref('')
const password = ref('')
const acceptTerms = ref(false)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const signupOpen = ref(false)
const signingUp = ref(false)

onMounted(async () => {
  signupOpen.value = (await api<{ signupOpen: boolean }>('/api/auth/status').catch(() => ({ signupOpen: false }))).signupOpen
})

function toggle() {
  signingUp.value = !signingUp.value
  error.value = ''
  notice.value = ''
}

const logIn = () => api<{ token: string }>('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } })

async function submit() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    if (signingUp.value) {
      await api('/api/auth/signup', { method: 'POST', body: { email: email.value, password: password.value, locale: locale.value, acceptTerms: acceptTerms.value } })
      // Sign-up answers the same for a new and an existing address. Logging in tells them apart for the person
      // who knows the password; anyone else is told to check the mail, which went to the address's owner.
      const res = await logIn().catch(() => null)
      if (!res) {
        notice.value = m.value.login.checkEmail
        return
      }
      setToken(res.token)
    } else {
      setToken((await logIn()).token)
    }
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
.list-row.terms { justify-content: flex-start; gap: 12px; padding: 12px 16px; font-size: 14px; line-height: 1.4; }
.list-row.terms input { width: 18px; height: 18px; flex: none; margin: 0; }
button.primary { width: 100%; padding: 13px; font-size: 16px; }
.error, .notice { margin: 0 0 12px; }
.other { margin-top: 20px; }
</style>
