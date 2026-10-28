<template>
  <div class="login">
    <img class="mark" src="/favicon.svg" alt="WattsWise" width="64" height="64" />
    <template v-if="!invite">
      <h1>{{ failed ? m.invite.failedTitle : m.invite.checking }}</h1>
      <p v-if="failed" class="muted lede">{{ failed }}</p>
      <NuxtLink v-if="failed" :to="loggedIn ? '/' : '/login'" class="button">{{ loggedIn ? m.verify.toApp : m.verify.toLogin }}</NuxtLink>
    </template>
    <template v-else>
      <h1>{{ m.invite.title(invite.household) }}</h1>
      <p class="muted lede">{{ m.invite.lede(invite.inviter) }}</p>
      <form @submit.prevent="submit">
        <!-- Logged out: log in or create the account for the invited address, which is fixed -->
        <div v-if="!loggedIn" class="list">
          <label class="list-row stack"><input :value="invite.email" type="email" :aria-label="m.login.email" autocomplete="username" readonly /></label>
          <label class="list-row stack">
            <input
              v-model="password" type="password" :placeholder="invite.account ? m.login.password : m.login.newPassword" :aria-label="m.login.password"
              :autocomplete="invite.account ? 'current-password' : 'new-password'" required minlength="8"
            />
          </label>
          <label v-if="!invite.account" class="list-row terms"><input v-model="acceptTerms" type="checkbox" required /><span>{{ m.login.acceptTerms }}</span></label>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="primary" type="submit" :disabled="busy">
          {{ busy ? m.invite.joining : loggedIn ? m.invite.join : invite.account ? m.invite.logInAndJoin : m.invite.createAndJoin }}
        </button>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
interface Invite {
  household: string
  inviter: string
  email: string
  account: boolean
}

const api = useApi()
const route = useRoute()
const { loggedIn, setToken, loadMe } = useAuth()
const { m, locale, serverText } = useLocale()
const token = String(route.query.token ?? '')
const invite = ref<Invite | null>(null)
const failed = ref('')
const password = ref('')
const acceptTerms = ref(false)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    invite.value = await api<Invite>('/api/invite/details', { method: 'POST', body: { token } })
  } catch (e: any) {
    failed.value = serverText(e?.data?.statusMessage) || m.value.invite.failedLede
  }
})

/** Joins as the logged-in user. Replacing their own household or leaving another one asks first. */
async function accept(confirmed = false): Promise<boolean> {
  try {
    await api('/api/invite/accept', { method: 'POST', body: { token, confirm: confirmed } })
    return true
  } catch (e: any) {
    if (!confirmed && e?.data?.data?.confirm && confirm(m.value.invite.confirm(serverText(e.data.statusMessage)))) return accept(true)
    if (!e?.data?.data?.confirm) throw e
    return false
  }
}

async function submit() {
  busy.value = true
  error.value = ''
  try {
    if (!loggedIn.value && !invite.value!.account) {
      const s = await api<{ token: string }>('/api/invite/signup', { method: 'POST', body: { token, password: password.value, locale: locale.value, acceptTerms: acceptTerms.value } })
      setToken(s.token)
    } else {
      if (!loggedIn.value) setToken((await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { email: invite.value!.email, password: password.value } })).token)
      if (!(await accept())) return
    }
    await loadMe(true)
    await navigateTo('/')
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.login.failed
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
.list-row.stack input[readonly] { color: var(--text-2); }
.list-row.terms { justify-content: flex-start; gap: 12px; padding: 12px 16px; font-size: 14px; line-height: 1.4; }
.list-row.terms input { width: 18px; height: 18px; flex: none; margin: 0; }
button.primary { width: 100%; padding: 13px; font-size: 16px; }
.error { margin: 0 0 12px; }
/* A link that looks like the primary button */
.button { display: block; padding: 13px; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 12px; background: var(--text); color: var(--bg); }
</style>
