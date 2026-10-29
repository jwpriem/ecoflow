<template>
  <SiteShell :lang="lang" page="faq" :title="t.title" :description="t.description">
    <header class="intro"><h1>{{ t.heading }}</h1></header>
    <div class="items">
      <details v-for="i in t.items" :key="i.q">
        <summary>{{ i.q }}</summary>
        <p>{{ i.a }}</p>
      </details>
    </div>
    <p class="still">{{ t.still }}</p>
    <p class="small"><a :href="legalPath('privacy', lang)">{{ SITE_TEXT[lang].footer.privacy }}</a> · <a :href="legalPath('steering', lang)">{{ SITE_TEXT[lang].footer.steering }}</a></p>
  </SiteShell>
</template>

<script setup lang="ts">
import { legalPath, SITE_TEXT, type SiteLang } from '~/utils/site'

/** The questions people ask before they sign up. The answers are in the page, so search engines see them too. */
const props = defineProps<{ lang: SiteLang }>()
const t = computed(() => SITE_TEXT[props.lang].faq)
</script>

<style scoped>
.intro { padding: 6vh 0 3vh; }
h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.04; font-stretch: 125%; letter-spacing: -0.03em; margin: 0; }
.items { max-width: 720px; }
details { border-top: 1px solid var(--rule); }
details:last-child { border-bottom: 1px solid var(--rule); }
summary { cursor: pointer; padding: 18px 32px 18px 0; font-size: 18px; font-weight: 600; list-style: none; position: relative; }
summary::-webkit-details-marker { display: none; }
summary::after { content: '+'; position: absolute; right: 4px; top: 14px; font-size: 24px; font-weight: 400; color: var(--text-2); }
details[open] summary::after { content: '–'; }
details p { margin: 0 0 20px; color: var(--text-2); line-height: 1.6; max-width: 62ch; }
.still { margin: 32px 0 8px; }
.small { font-size: 14px; color: var(--text-2); }
.small a { color: var(--text-2); }
</style>
