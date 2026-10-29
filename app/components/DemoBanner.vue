<template>
  <!-- The shared demo household: say so on every page, and offer the way to an account of one's own -->
  <div v-if="me?.demo" class="demo-banner note" role="status">
    <span>{{ m.demo.banner }}</span>
    <button type="button" class="plain" @click="createOwn">{{ m.demo.create }}</button>
  </div>
</template>

<script setup lang="ts">
const api = useApi()
const { me, setToken } = useAuth()
const { m } = useLocale()

/** Out of the demo and onto the sign-up form */
async function createOwn() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  setToken(null)
  await navigateTo('/login?signup=1')
}
</script>

<style scoped>
.demo-banner { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0 0 20px; }
.demo-banner .plain { padding: 0; font-size: 14px; font-weight: 600; }
</style>
