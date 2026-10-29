<template>
  <!-- Who is in the household. The owner invites and removes members; a member can leave -->
  <section v-if="data" class="group">
    <h3 class="section-title">{{ m.household.title }}</h3>
    <div class="list">
      <div v-for="p in data.members" :key="p.userId" class="list-row indent">
        <div class="lead">
          <span class="icon-tile"><AppIcon :name="p.role === 'owner' ? 'house' : 'person'" /></span>
          <span class="stack-text">
            <span class="title">{{ p.email }}</span>
            <span class="small muted">{{ m.household[p.role] }}{{ p.you ? ` · ${m.household.you}` : '' }}</span>
          </span>
        </div>
        <button v-if="isOwner && p.role === 'member'" type="button" class="plain danger" :disabled="busy !== ''" @click="remove(p)">{{ m.household.remove }}</button>
      </div>
      <div v-for="i in data.invites" :key="`i${i.id}`" class="list-row indent">
        <div class="lead">
          <span class="icon-tile"><AppIcon name="key" /></span>
          <span class="stack-text"><span class="title">{{ i.email }}</span><span class="small muted">{{ m.household.invited(day(i.expiresAt)) }}</span></span>
        </div>
        <button type="button" class="plain danger" :disabled="busy !== ''" @click="revoke(i.id)">{{ m.household.revoke }}</button>
      </div>
      <form v-if="isOwner" class="list-row invite" @submit.prevent="invite">
        <input v-model="email" type="email" :placeholder="m.household.inviteEmail" :aria-label="m.household.inviteEmail" autocomplete="off" required />
        <button class="primary" type="submit" :disabled="busy !== ''">{{ busy === 'invite' ? m.household.inviting : m.household.invite }}</button>
      </form>
      <div v-else class="list-row"><button type="button" class="plain danger" :disabled="busy !== ''" @click="leave">{{ m.household.leave }}</button></div>
    </div>
    <p class="foot" :class="{ error: msg && !msg.ok }" role="status">{{ msg?.text ?? m.household.foot }}</p>
  </section>
</template>

<script setup lang="ts">
interface Household {
  name: string
  role: 'owner' | 'member'
  members: { userId: number; email: string; role: 'owner' | 'member'; you: boolean }[]
  invites: { id: number; email: string; expiresAt: string }[]
}

const api = useApi()
const { loadMe } = useAuth()
const { m, locale, serverText } = useLocale()
const data = ref<Household | null>(null)
const email = ref('')
const busy = ref('')
const msg = ref<{ ok: boolean; text: string } | null>(null)
const isOwner = computed(() => data.value?.role === 'owner')

const day = (iso: string) => new Date(iso).toLocaleDateString(locale.value, { day: 'numeric', month: 'long' })
const load = async () => (data.value = await api<Household>('/api/household'))

async function run(what: string, fn: () => Promise<unknown>, done?: string) {
  busy.value = what
  msg.value = null
  try {
    await fn()
    if (done) msg.value = { ok: true, text: done }
  } catch (e: any) {
    msg.value = { ok: false, text: serverText(e?.data?.statusMessage) || m.value.settings.noAnswer }
  } finally {
    busy.value = ''
  }
}

const invite = () =>
  run('invite', async () => {
    const sent = await api<{ email: string }>('/api/household/invites', { method: 'POST', body: { email: email.value } })
    email.value = ''
    await load()
    msg.value = { ok: true, text: m.value.household.sent(sent.email) }
  })

const revoke = (id: number) => run('revoke', async () => (await api(`/api/household/invites/${id}`, { method: 'DELETE' }), await load()))

function remove(p: Household['members'][number]) {
  if (!confirm(m.value.household.confirmRemove(p.email))) return
  run('remove', async () => (await api(`/api/household/members/${p.userId}`, { method: 'DELETE' }), await load()))
}

function leave() {
  if (!confirm(m.value.household.confirmLeave)) return
  run('leave', async () => {
    await api('/api/household/leave', { method: 'POST' })
    // A new, empty household: start over from the home screen
    await loadMe(true)
    await navigateTo('/app')
  })
}

onMounted(() => load().catch(() => undefined))
</script>

<style scoped>
.stack-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lead { min-width: 0; }
.invite { gap: 12px; }
.invite input { flex: 1; min-width: 0; }
.invite .primary { flex: none; }
.foot { font-size: 13px; color: var(--text-2); margin: -4px 2px 0; max-width: 60ch; }
</style>
