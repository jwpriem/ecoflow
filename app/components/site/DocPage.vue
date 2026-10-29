<template>
  <SiteShell :lang="lang" :page="doc" :title="t.title" :description="t.description">
    <article class="doc">
      <p v-if="updated" class="updated small">{{ SITE_TEXT[lang].docs.updated }}: <time :datetime="version">{{ updated }}</time></p>
      <!-- Our own Markdown from content/, not user input -->
      <div class="md" v-html="html" />
    </article>
  </SiteShell>
</template>

<script setup lang="ts">
import { guideHtml } from '~/utils/guides'
import { legalHtml, legalVersion } from '~/utils/legal'
import { SITE_DOCS, SITE_TEXT, type SiteDoc, type SiteLang } from '~/utils/site'

/** A legal text or a how-to guide on the website: the same Markdown the app shows under /legal and /guides. */
const props = defineProps<{ lang: SiteLang; doc: SiteDoc }>()
const t = computed(() => SITE_TEXT[props.lang].docs[props.doc])
const legal = computed(() => (SITE_DOCS.legal as readonly string[]).includes(props.doc))
const html = computed(() => (legal.value ? legalHtml : guideHtml)(props.doc, props.lang) ?? '')
const version = computed(() => (legal.value ? legalVersion(props.doc, props.lang) : undefined))
const updated = computed(() =>
  version.value
    ? new Intl.DateTimeFormat(props.lang === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${version.value}T00:00:00Z`))
    : undefined,
)
</script>

<style scoped>
.doc { max-width: 680px; padding: 5vh 0 0; }
.updated { margin: 0 0 12px; color: var(--text-2); }
.small { font-size: 14px; }
.doc :deep(h1) { font-size: clamp(30px, 5vw, 44px); line-height: 1.08; }
.doc :deep(p), .doc :deep(li) { font-size: 16px; line-height: 1.6; max-width: 66ch; }
</style>
