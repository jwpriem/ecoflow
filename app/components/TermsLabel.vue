<template>
  <span>
    {{ m.login.acceptTerms }}
    <NuxtLink :to="`/legal/terms?from=${encodeURIComponent(from)}`" class="legal-link">{{ m.legal.terms }}</NuxtLink>
    {{ m.legal.and }}
    <NuxtLink :to="`/legal/privacy?from=${encodeURIComponent(from)}`" class="legal-link">{{ m.legal.privacy }}</NuxtLink>
  </span>
</template>

<script setup lang="ts">
/** The sign-up consent text with links to the terms and the privacy policy (opened in the app, back to `from`) */
defineProps<{ from: string }>()
const { m } = useLocale()
</script>

<style scoped>
.legal-link { color: var(--sys-blue); }
</style>
