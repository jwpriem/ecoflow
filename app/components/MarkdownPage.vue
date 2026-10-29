<template>
  <article class="md-page">
    <NuxtLink :to="back" class="back small">‹ {{ m.guides.back }}</NuxtLink>
    <!-- Our own Markdown from content/, not user input -->
    <div v-if="html" class="md" v-html="html" />
    <p v-else class="muted">{{ m.guides.notFound }}</p>
  </article>
</template>

<script setup lang="ts">
/** A guide or a legal text: readable without logging in, linked from the app and the website. */
const props = defineProps<{ render: (name: string, locale: 'en' | 'nl') => string | undefined; title: string }>()
const route = useRoute()
const { m, locale } = useLocale()
const { loggedIn } = useAuth()
// ?lang=en|nl for links from the website, otherwise the app's language
const lang = computed(() => (route.query.lang === 'en' || route.query.lang === 'nl' ? route.query.lang : locale.value))
const html = computed(() => props.render(String(route.params.name), lang.value))
// Back to where it was opened from (Settings, sign-up or an onboarding step), only within the app
const back = computed(() => (typeof route.query.from === 'string' && /^\/(?!\/)/.test(route.query.from) ? route.query.from : loggedIn.value ? '/settings' : '/login'))
useHead({ title: () => `${props.title} · WattsWise` })
</script>

<style scoped>
.md-page { max-width: 640px; margin: 0 auto; padding: 8px 0 48px; }
.back { display: inline-block; margin-bottom: 12px; color: var(--text-2); text-decoration: none; }
/* The Markdown itself is styled in main.css (.md), shared with the website */
</style>
