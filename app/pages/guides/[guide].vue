<template>
  <article class="guide">
    <NuxtLink :to="back" class="back small">‹ {{ m.guides.back }}</NuxtLink>
    <!-- Our own Markdown from content/guides, not user input -->
    <div v-if="html" class="md" v-html="html" />
    <p v-else class="muted">{{ m.guides.notFound }}</p>
  </article>
</template>

<script setup lang="ts">
const route = useRoute()
const { m, locale } = useLocale()
const { loggedIn } = useAuth()
// ?lang=en|nl for links from the website, otherwise the app's language
const lang = computed(() => (route.query.lang === 'en' || route.query.lang === 'nl' ? route.query.lang : locale.value))
const html = computed(() => guideHtml(String(route.params.guide), lang.value))
// Back to where the guide was opened from (Settings or an onboarding step), only within the app
const back = computed(() => (typeof route.query.from === 'string' && /^\/(?!\/)/.test(route.query.from) ? route.query.from : loggedIn.value ? '/settings' : '/login'))
useHead({ title: () => `${m.value.guides.title} · WattsWise` })
</script>

<style scoped>
.guide { max-width: 640px; margin: 0 auto; padding: 8px 0 48px; }
.back { display: inline-block; margin-bottom: 12px; color: var(--text-2); text-decoration: none; }
.md :deep(h1) { font-size: 28px; font-stretch: 125%; letter-spacing: -0.02em; margin: 0 0 12px; }
.md :deep(h2) { font-size: 18px; margin: 28px 0 8px; }
.md :deep(p), .md :deep(li) { font-size: 15px; line-height: 1.55; }
.md :deep(ol), .md :deep(ul) { padding-left: 22px; }
.md :deep(li) { margin: 4px 0; }
.md :deep(code) { font-size: 13px; padding: 1px 5px; border-radius: 5px; background: var(--surface-2); }
.md :deep(a) { color: var(--sys-blue); }
/* Where a screenshot goes, until the real one is added */
.md :deep(.shot) { margin: 12px 0; padding: 28px 16px; border: 1px dashed var(--separator); border-radius: 12px; text-align: center; color: var(--text-2); font-size: 13px; }
.md :deep(.shot)::before { content: '📷'; display: block; font-size: 22px; margin-bottom: 6px; }
</style>
