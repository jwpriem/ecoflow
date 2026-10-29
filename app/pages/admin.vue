<template>
  <!-- For anyone but an admin this page doesn't exist -->
  <div v-if="me && !isAdmin" class="missing">
    <h1>404</h1>
    <p class="muted">{{ m.admin.notFound }}</p>
    <NuxtLink to="/app">{{ m.verify.toApp }}</NuxtLink>
  </div>
  <div v-else-if="isAdmin">
    <header class="page-head"><h1>{{ m.admin.title }}</h1></header>
    <Segmented v-model="tab" :options="tabs" full />

    <form v-if="tab === 'users' || tab === 'households'" class="search" @submit.prevent="search">
      <input v-model="q" type="search" :placeholder="tab === 'users' ? m.admin.searchUsers : m.admin.searchHouseholds" :aria-label="m.admin.search" />
    </form>
    <p v-if="error" class="error" role="status">{{ error }}</p>

    <!-- System: who may sign up, how the jobs run, which connections fail -->
    <template v-if="tab === 'system' && system">
      <h3 class="section-title">{{ m.admin.signup }}</h3>
      <div class="list">
        <label class="list-row flag-row">
          <span class="stack-text"><span>{{ m.admin.signupOpen }}</span><span class="small muted">{{ system.signupMode === 'open' ? m.admin.signupOpenHelp : m.admin.signupClosedHelp }}</span></span>
          <span class="switch"><input type="checkbox" :checked="system.signupMode === 'open'" :disabled="busy !== ''" @change="setSignup(($event.target as HTMLInputElement).checked)" /><span /></span>
        </label>
      </div>
      <div class="figures">
        <div><span class="f-label">{{ m.admin.users }}</span><span class="f-value">{{ system.counts.users }}</span></div>
        <div><span class="f-label">{{ m.admin.households }}</span><span class="f-value">{{ system.counts.households }}</span><span class="f-note">{{ m.admin.steering(system.counts.steering) }}</span></div>
      </div>
      <h3 class="section-title">{{ m.admin.jobs }}</h3>
      <p v-if="!system.jobsEnabled" class="note">{{ m.admin.jobsOff }}</p>
      <div class="list">
        <div v-for="j in system.jobs" :key="j.job" class="list-row">
          <span class="stack-text">
            <span class="row"><span class="dot" :class="j.late ? 'err' : j.sitesFailed || j.sitesTimedOut ? '' : 'ok'" />{{ j.job }} <span class="small muted">{{ m.admin.every(j.everyMinutes) }}</span></span>
            <span class="small muted">
              {{ j.lastRunAt ? m.admin.lastRun(when(j.lastRunAt), j.durationMs ?? 0, j.sitesOk ?? 0, j.sitesFailed ?? 0, j.sitesTimedOut ?? 0) : m.admin.noRun }}<template v-if="j.runsWithFailures24h"> · {{ m.admin.failures24h(j.runsWithFailures24h) }}</template>
            </span>
            <span v-for="e in j.errors.slice(0, 5)" :key="e.siteId" class="small job-error">#{{ e.siteId }}: {{ e.error }}</span>
          </span>
          <span v-if="j.late" class="pill neg">{{ m.admin.late }}</span>
        </div>
      </div>
      <h3 class="section-title">{{ m.admin.providerErrors }}</h3>
      <div class="list">
        <details v-for="p in system.providerErrors" :key="p.provider" class="conn">
          <summary class="list-row"><span class="row"><span class="dot err" />{{ p.provider }}</span><span class="detail">{{ p.count }}</span></summary>
          <div class="conn-body small">
            <p v-for="h in p.households" :key="h.siteId">
              {{ h.household }} #{{ h.siteId }} · {{ h.lastOkAt ? m.admin.lastOk(when(h.lastOkAt)) : m.admin.neverOk }}<br /><span class="muted">{{ h.lastError }}</span>
            </p>
          </div>
        </details>
        <p v-if="!system.providerErrors.length" class="list-row muted">{{ m.admin.noErrors }}</p>
      </div>

      <h3 class="section-title">{{ m.admin.errorReports }}</h3>
      <div class="list">
        <div class="list-row">
          <span class="stack-text"><span>{{ system.errorReports ? m.admin.errorReportsOn : m.admin.errorReportsOff }}</span><span class="small muted">{{ testSent ? m.admin.testSent : m.admin.errorReportsHelp }}</span></span>
          <button v-if="system.errorReports" type="button" class="plain" :disabled="busy !== ''" @click="sendTest">{{ m.admin.sendTest }}</button>
        </div>
      </div>
    </template>

    <!-- Users -->
    <div v-if="tab === 'users' && users" class="list">
      <details v-for="u in users.users" :key="u.id" class="conn">
        <summary class="list-row">
          <span class="stack-text">
            <span class="title">{{ u.email }}</span>
            <span class="small muted">{{ m.admin.seen(when(u.lastSeenAt)) }}</span>
          </span>
          <span class="badges">
            <span v-if="u.role === 'admin'" class="pill">{{ m.admin.admin }}</span>
            <span v-if="u.experimental" class="pill">{{ m.admin.experimental }}</span>
            <span v-if="!u.emailVerifiedAt" class="pill">{{ m.admin.unverified }}</span>
            <span v-if="u.disabledAt" class="pill neg">{{ m.admin.disabled }}</span>
            <span v-for="c in u.connections" :key="c.provider" class="dot" :class="c.status === 'ok' ? 'ok' : c.status === 'error' ? 'err' : ''" :title="c.provider" />
          </span>
        </summary>
        <div class="conn-body">
          <p class="small muted">
            {{ m.admin.created(when(u.createdAt)) }} ·
            {{ u.household ? m.admin.inHousehold(u.household.name, m.household[u.household.role]) : m.admin.noHousehold }}
          </p>
          <ul v-if="u.connections.length" class="conns small">
            <li v-for="c in u.connections" :key="c.provider">
              <span class="dot" :class="c.status === 'ok' ? 'ok' : c.status === 'error' ? 'err' : ''" />
              {{ c.provider }}: {{ c.status }}<template v-if="c.lastError"> · {{ c.lastError }}</template>
            </li>
          </ul>
          <label v-for="f in FLAGS" :key="f" class="flag">
            <span>{{ m.admin.flag[f] }}</span>
            <span class="switch">
              <input type="checkbox" :checked="flag(u, f)" :disabled="busy !== '' || (u.id === me?.id && f !== 'experimental')" @change="setFlag(u, f, ($event.target as HTMLInputElement).checked)" /><span />
            </span>
          </label>
          <div class="row actions">
            <button v-if="!u.emailVerifiedAt" type="button" class="plain" :disabled="busy !== ''" @click="resend(u)">{{ m.admin.resend }}</button>
            <button v-if="u.id !== me?.id" type="button" class="plain danger" :disabled="busy !== ''" @click="remove(u)">{{ m.admin.delete }}</button>
          </div>
        </div>
      </details>
      <p v-if="!users.users.length" class="list-row muted">{{ m.admin.none }}</p>
    </div>

    <!-- Households -->
    <div v-if="tab === 'households' && households" class="list">
      <details v-for="h in households.households" :key="h.id" class="conn">
        <summary class="list-row">
          <span class="stack-text">
            <span class="title">{{ h.name }} <span class="muted small">#{{ h.id }}</span></span>
            <span class="small muted">{{ m.admin.householdLine(h.members.length, h.devices.length, h.controlMode === 'auto' ? m.admin.steers : m.admin.monitors) }}</span>
          </span>
          <span class="badges">
            <span v-for="c in h.connections" :key="c.provider" class="dot" :class="c.status === 'ok' ? 'ok' : c.status === 'error' ? 'err' : ''" :title="c.provider" />
          </span>
        </summary>
        <div class="conn-body small">
          <p class="muted">{{ m.admin.collected(h.lastCollectAt ? when(h.lastCollectAt) : m.admin.notYet) }}</p>
          <p v-for="p in h.members" :key="p.userId">{{ p.email }} · {{ m.household[p.role] }}</p>
          <p v-for="d in h.devices" :key="d.id" class="muted">{{ d.name }} ({{ d.model }})</p>
          <ul v-if="h.connections.length" class="conns">
            <li v-for="c in h.connections" :key="c.provider">
              <span class="dot" :class="c.status === 'ok' ? 'ok' : c.status === 'error' ? 'err' : ''" />
              {{ c.provider }}: {{ c.status }}<template v-if="c.lastOkAt"> · {{ m.admin.lastOk(when(c.lastOkAt)) }}</template><template v-if="c.lastError"> · {{ c.lastError }}</template>
            </li>
          </ul>
        </div>
      </details>
      <p v-if="!households.households.length" class="list-row muted">{{ m.admin.none }}</p>
    </div>

    <!-- What admins did -->
    <div v-if="tab === 'audit' && log" class="list">
      <div v-for="a in log" :key="a.id" class="list-row">
        <span class="stack-text">
          <span>{{ a.action }} · #{{ a.targetUserId }} <span class="muted">{{ JSON.stringify(a.detail) }}</span></span>
          <span class="small muted">{{ a.admin ?? '?' }} · {{ when(a.createdAt) }}</span>
        </span>
      </div>
      <p v-if="!log.length" class="list-row muted">{{ m.admin.none }}</p>
    </div>

    <div v-if="(tab === 'users' || tab === 'households') && pages > 1" class="row pager">
      <button type="button" class="plain" :disabled="page === 0" @click="go(page - 1)">{{ m.admin.prev }}</button>
      <span class="small muted">{{ m.admin.page(page + 1, pages) }}</span>
      <button type="button" class="plain" :disabled="page + 1 >= pages" @click="go(page + 1)">{{ m.admin.next }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
type Flag = 'experimental' | 'admin' | 'disabled'
interface Connection { provider: string; status: string; lastOkAt: string | null; lastError: string | null }
interface AdminUser {
  id: number
  email: string
  role: 'user' | 'admin'
  experimental: boolean
  emailVerifiedAt: string | null
  disabledAt: string | null
  createdAt: string
  lastSeenAt: string | null
  household: { id: number; name: string; role: 'owner' | 'member' } | null
  connections: Connection[]
}
interface AdminHousehold {
  id: number
  name: string
  controlMode: 'auto' | 'manual'
  lastCollectAt: string | null
  members: { userId: number; email: string; role: 'owner' | 'member' }[]
  devices: { id: number; name: string; model: string }[]
  connections: Connection[]
}
interface SystemInfo {
  errorReports: boolean
  signupMode: 'open' | 'closed'
  jobsEnabled: boolean
  counts: { users: number; households: number; steering: number }
  jobs: { job: string; everyMinutes: number; lastRunAt: string | null; durationMs: number | null; sitesOk: number | null; sitesFailed: number | null; sitesTimedOut: number | null; errors: { siteId: number; error: string }[]; runsWithFailures24h: number; late: boolean }[]
  providerErrors: { provider: string; count: number; households: { siteId: number; household: string; lastError: string | null; lastOkAt: string | null }[] }[]
}
interface AuditRow { id: number; admin: string | null; action: string; targetUserId: number | null; detail: Record<string, unknown>; createdAt: string }

const PAGE = 50
const FLAGS: Flag[] = ['experimental', 'admin', 'disabled']
const api = useApi()
const { me, isAdmin, loadMe } = useAuth()
const { m, locale, serverText } = useLocale()
const tab = ref<'system' | 'users' | 'households' | 'audit'>('system')
const tabs = computed(() => [
  { value: 'system' as const, label: m.value.admin.system },
  { value: 'users' as const, label: m.value.admin.users },
  { value: 'households' as const, label: m.value.admin.households },
  { value: 'audit' as const, label: m.value.admin.audit },
])
const q = ref('')
const page = ref(0)
const users = ref<{ total: number; users: AdminUser[] } | null>(null)
const households = ref<{ total: number; households: AdminHousehold[] } | null>(null)
const log = ref<AuditRow[] | null>(null)
const system = ref<SystemInfo | null>(null)
const busy = ref('')
const error = ref('')

const total = computed(() => (tab.value === 'users' ? users.value?.total : households.value?.total) ?? 0)
const pages = computed(() => Math.ceil(total.value / PAGE))
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale.value, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : m.value.admin.never
const flag = (u: AdminUser, f: Flag) => (f === 'admin' ? u.role === 'admin' : f === 'disabled' ? !!u.disabledAt : u.experimental)

async function load() {
  error.value = ''
  try {
    const query = { q: q.value, page: page.value }
    if (tab.value === 'users') users.value = await api('/api/admin/users', { query })
    else if (tab.value === 'households') households.value = await api('/api/admin/households', { query })
    else if (tab.value === 'system') system.value = await api('/api/admin/system')
    else log.value = await api('/api/admin/audit')
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.settings.noAnswer
  }
}
const search = () => go(0)
function go(p: number) {
  page.value = p
  load()
}
watch(tab, () => go(0))

async function act(what: string, fn: () => Promise<unknown>) {
  busy.value = what
  error.value = ''
  try {
    await fn()
    await load()
  } catch (e: any) {
    error.value = serverText(e?.data?.statusMessage) || m.value.settings.noAnswer
    await load()
  } finally {
    busy.value = ''
  }
}
const setFlag = (u: AdminUser, f: Flag, on: boolean) => {
  if (f === 'disabled' && on && !confirm(m.value.admin.confirmDisable(u.email))) return load()
  act('flag', () => api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { [f]: on } }))
}
function setSignup(open: boolean) {
  if (!confirm(open ? m.value.admin.confirmOpen : m.value.admin.confirmClose)) return load()
  act('signup', () => api('/api/admin/signup-mode', { method: 'PUT', body: { mode: open ? 'open' : 'closed' } }))
}
const testSent = ref(false)
const { $reportTestError } = useNuxtApp()
async function sendTest() {
  await act('test', () => api('/api/admin/error-test', { method: 'POST' }))
  ;($reportTestError as (() => void) | undefined)?.()
  testSent.value = !error.value
}
const resend = (u: AdminUser) => act('resend', () => api(`/api/admin/users/${u.id}/verification`, { method: 'POST' }))
function remove(u: AdminUser) {
  if (!confirm(u.household?.role === 'owner' ? m.value.admin.confirmDeleteOwner(u.email, u.household.name) : m.value.admin.confirmDelete(u.email))) return
  act('delete', () => api(`/api/admin/users/${u.id}`, { method: 'DELETE' }))
}

onMounted(async () => {
  await loadMe().catch(() => undefined)
  if (isAdmin.value) await load()
})
</script>

<style scoped>
.missing { text-align: center; margin-top: 18vh; }
.search { margin: 16px 0 12px; }
.error { margin: 0 0 12px; }
.conn > summary { list-style: none; cursor: pointer; }
.conn > summary::-webkit-details-marker { display: none; }
.conn + .conn > summary::before { content: ''; position: absolute; top: 0; left: 16px; right: 0; height: 1px; background: var(--rule); }
.conn-body { padding: 4px 16px 16px; }
.conn-body p { margin: 0 0 6px; }
.stack-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badges { display: flex; align-items: center; gap: 6px; flex: none; flex-wrap: wrap; justify-content: flex-end; max-width: 50%; }
.pill.neg { color: var(--alert); border-color: var(--alert); }
.conns { list-style: none; padding: 0; margin: 6px 0 10px; display: grid; gap: 4px; }
.conns li { display: flex; align-items: baseline; gap: 6px; overflow-wrap: anywhere; }
.flag { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
.actions { margin-top: 6px; gap: 16px; }
.flag-row .stack-text { padding-right: 12px; }
.figures > div { display: flex; flex-direction: column; gap: 2px; padding: 14px 0; }
.figures { margin: 16px 0 0; }
.detail { color: var(--text-2); }
.job-error { color: var(--alert); overflow-wrap: anywhere; }
.pager { justify-content: center; gap: 16px; }
</style>
