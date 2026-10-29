<template>
  <!-- The steering disclaimer changed since the owner accepted it: steering keeps running, the owner is asked again -->
  <div v-if="me?.steeringConsentDue" class="consent note" role="status">
    <span>{{ m.consent.banner }}</span>
    <button type="button" class="plain" @click="read">{{ m.consent.read }}</button>
    <SteeringConsent ref="sheet" />
  </div>
</template>

<script setup lang="ts">
const { me, loadMe } = useAuth()
const { m } = useLocale()
const sheet = ref<{ ask: (version: string) => Promise<boolean> } | null>(null)

async function read() {
  if (me.value?.steeringConsentDue && (await sheet.value?.ask(me.value.steeringConsentDue))) await loadMe(true)
}
</script>

<style scoped>
.consent { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0 0 20px; }
.consent .plain { padding: 0; font-size: 14px; }
</style>
