<template>
  <dialog ref="dlg" class="sheet" @close="settle(false)" @click.self="dlg?.close()">
    <form method="dialog" @submit.prevent="accept">
      <h2 tabindex="-1" autofocus>{{ m.consent.title }}</h2>
      <p class="small muted">{{ m.consent.lede }}</p>
      <!-- Our own Markdown from content/legal, not user input -->
      <div class="md" v-html="html" />
      <p v-if="error" class="small neg">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="dlg?.close()">{{ m.consent.cancel }}</button>
        <button type="submit" class="primary" :disabled="busy">{{ busy ? m.consent.saving : m.consent.agree }}</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { legalHtml } from '~/utils/legal'

/**
 * The steering disclaimer, accepted before WattsWise sends settings to the batteries.
 * `ask(version)` shows it and resolves true once the server recorded the consent, false when cancelled.
 */
const api = useApi()
const { m, locale, serverText } = useLocale()
const dlg = ref<HTMLDialogElement | null>(null)
const busy = ref(false)
const error = ref('')
const version = ref('')
const html = computed(() => legalHtml('steering', locale.value) ?? '')
let resolve: ((ok: boolean) => void) | null = null

function settle(ok: boolean) {
  resolve?.(ok)
  resolve = null
}

function ask(v: string) {
  version.value = v
  error.value = ''
  dlg.value?.showModal()
  return new Promise<boolean>((r) => (resolve = r))
}

async function accept() {
  busy.value = true
  error.value = ''
  try {
    await api('/api/consents/steering', { method: 'POST', body: { version: version.value } })
    settle(true)
    dlg.value?.close()
  } catch (e: any) {
    // The disclaimer changed while it was open: show the new version's number and let them accept again
    if (e?.data?.data?.version) version.value = e.data.data.version
    error.value = serverText(e?.data?.statusMessage) || e?.message || m.value.common.failed
  } finally {
    busy.value = false
  }
}

defineExpose({ ask })
</script>

<style scoped>
.sheet {
  border: 0; padding: 0; margin: auto auto 0; width: 100%; max-width: 520px; max-height: 88vh;
  background: var(--surface); color: var(--text); border-radius: var(--radius) var(--radius) 0 0;
}
.sheet::backdrop { background: rgba(0, 0, 0, 0.4); }
form { padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
h2 { font-size: 19px; font-weight: 700; margin: 0 0 8px; outline: none; }
.md { margin-top: 12px; padding: 4px 12px; max-height: 45vh; overflow-y: auto; border-radius: 12px; background: var(--surface-2); }
.md :deep(h1) { font-size: 17px; margin: 10px 0 6px; }
.md :deep(h2) { font-size: 15px; margin: 14px 0 4px; }
.md :deep(p), .md :deep(li) { font-size: 14px; line-height: 1.5; }
.md :deep(ul), .md :deep(ol) { padding-left: 20px; }
.md :deep(a) { color: var(--sys-blue); }
.small { font-size: 13px; margin: 0; }
.muted { color: var(--text-2); }
.neg { color: var(--alert); margin-top: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
@media (min-width: 560px) {
  .sheet { margin: auto; border-radius: var(--radius); }
}
</style>
