<template>
  <section class="load-error" role="alert">
    <h2>{{ text.title }}</h2>
    <p>{{ text.detail }}</p>
    <button type="button" :disabled="busy" @click="emit('retry')">{{ busy ? m.common.tryingAgain : m.common.tryAgain }}</button>
  </section>
</template>

<script setup lang="ts">
// What went wrong when a page couldn't load, and what happens next, instead of the server's raw status text
const props = defineProps<{ error: any; what: string; busy?: boolean; auto?: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const { m, serverText } = useLocale()

const text = computed(() => {
  const status: number | undefined = props.error?.statusCode ?? props.error?.response?.status
  const msg = serverText(props.error?.data?.statusMessage)
  const t = m.value.load
  const again = props.auto ? t.autoRetry : ''
  if (!status) return { title: t.unreachable, detail: t.checkConnection(again) }
  if (status >= 500) return { title: t.serverDown, detail: t.serverDownDetail(status, msg, props.what, again) }
  return { title: t.couldntLoad(props.what), detail: msg ? `${msg}.` : t.serverReplied(status) }
})
</script>

<style scoped>
.load-error { border-left: 3px solid var(--alert); padding: 4px 0 4px 14px; margin: 20px 0 28px; }
h2 { font-size: 21px; font-weight: 700; font-stretch: 112%; margin: 0 0 6px; }
p { margin: 0 0 14px; color: var(--text-2); max-width: 44ch; }
</style>
