<template>
  <div class="site">
    <header class="site-head">
      <NuxtLink :to="sitePath('home', lang)" class="brand" :aria-label="`WattsWise · ${t.tagline}`">
        <!-- Both logos are in the page; the sky (set before the first paint) picks one, so the prerendered HTML fits day and night -->
        <img class="logo logo-day" src="/brand/wattswise-logo-light.svg" alt="" width="150" height="23" />
        <img class="logo logo-night" src="/brand/wattswise-logo-dark.svg" alt="" width="150" height="23" />
      </NuxtLink>
      <nav class="site-nav" :aria-label="t.tagline">
        <NuxtLink :to="other" :hreflang="otherLang" :lang="otherLang" :aria-label="t.nav.otherLangLabel" class="lang">{{ t.nav.otherLang }}</NuxtLink>
        <a href="/login" class="login">{{ t.nav.login }}</a>
        <a href="/login?signup=1" class="start">{{ t.nav.start }}</a>
      </nav>
    </header>
    <nav class="site-pages" :aria-label="t.nav.pagesLabel">
      <NuxtLink v-for="p in PAGES" :key="p" :to="sitePath(p, lang)" :aria-current="p === page ? 'page' : undefined">{{ t.nav.pages[p] }}</NuxtLink>
    </nav>
    <!-- Links into the app (login, legal texts) are plain <a>: the app is a separate client-side bundle -->
    <main class="site-main"><slot /></main>
    <footer class="site-foot">
      <p class="tagline">WattsWise · {{ t.tagline }}</p>
      <p class="small muted">{{ t.footer.made }}</p>
      <nav class="foot-links small" aria-label="Legal">
        <a :href="legalPath('privacy', lang)">{{ t.footer.privacy }}</a>
        <a :href="legalPath('terms', lang)">{{ t.footer.terms }}</a>
        <a :href="legalPath('steering', lang)">{{ t.footer.steering }}</a>
        <a href="mailto:hello@wattswise.eu">{{ t.footer.contact }}</a>
        <NuxtLink :to="other" :hreflang="otherLang" :lang="otherLang">{{ t.nav.otherLang }}</NuxtLink>
      </nav>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { legalPath, SITE_PAGES, SITE_TEXT, SITE_URL, type SiteLang, type SitePage, sitePath } from '~/utils/site'

/** The website's frame: header with language switch and the way into the app, footer with the legal texts. */
const props = defineProps<{ lang: SiteLang; page: SitePage; title: string; description: string }>()
const t = computed(() => SITE_TEXT[props.lang])
const PAGES = ['how', 'devices', 'faq'] as const
const otherLang = computed<SiteLang>(() => (props.lang === 'nl' ? 'en' : 'nl'))
const other = computed(() => sitePath(props.page, otherLang.value))
const url = (lang: SiteLang) => `${SITE_URL}${SITE_PAGES[props.page][lang]}`

useHead({
  htmlAttrs: { lang: () => props.lang },
  link: () => [
    { rel: 'canonical', href: url(props.lang) },
    { rel: 'alternate', hreflang: 'nl', href: url('nl') },
    { rel: 'alternate', hreflang: 'en', href: url('en') },
    { rel: 'alternate', hreflang: 'x-default', href: url('nl') },
  ],
})
useSeoMeta({
  title: () => props.title,
  description: () => props.description,
  ogTitle: () => props.title,
  ogDescription: () => props.description,
  ogType: 'website',
  ogUrl: () => url(props.lang),
  ogImage: `${SITE_URL}/og.png`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'WattsWise · Use your watts wisely',
  ogLocale: () => (props.lang === 'nl' ? 'nl_NL' : 'en_GB'),
  ogSiteName: 'WattsWise',
  twitterCard: 'summary_large_image',
})
</script>

<style scoped>
.site { min-height: 100vh; display: flex; flex-direction: column; }
.site-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  max-width: 1080px; width: 100%; margin: 0 auto; padding: calc(16px + env(safe-area-inset-top)) 16px 16px;
}
.brand { display: flex; align-items: center; flex: none; }
.logo { height: 23px; width: auto; }
.logo-night { display: none; }
:root[data-sky='night'] .logo-day { display: none; }
:root[data-sky='night'] .logo-night { display: block; }
.site-nav { display: flex; align-items: center; gap: 14px; font-size: 15px; }
.site-nav a { color: var(--text); text-decoration: none; }
.site-nav .lang { color: var(--text-2); }
.site-nav .start { padding: 8px 14px; border-radius: 999px; background: var(--text); color: var(--bg); font-weight: 600; white-space: nowrap; }
.site-pages { display: flex; flex-wrap: wrap; gap: 4px 20px; max-width: 1080px; width: 100%; margin: 0 auto; padding: 0 16px 8px; font-size: 15px; }
.site-pages a { color: var(--text-2); text-decoration: none; padding: 6px 0; border-bottom: 2px solid transparent; }
.site-pages a:hover { color: var(--text); }
.site-pages a[aria-current='page'] { color: var(--text); border-bottom-color: var(--text); }
.site-main { flex: 1; max-width: 1080px; width: 100%; margin: 0 auto; padding: 0 16px; }
.site-foot { max-width: 1080px; width: 100%; margin: 64px auto 0; padding: 24px 16px calc(32px + env(safe-area-inset-bottom)); border-top: 1px solid var(--separator); }
.tagline { margin: 0 0 4px; font-weight: 600; font-stretch: 112%; }
.foot-links { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; }
.foot-links a { color: var(--text-2); }
.small { font-size: 13px; }
.muted { color: var(--text-2); margin: 0; }
/* On a narrow phone the header keeps the logo and the two ways in; the language switch moves to the footer row */
@media (max-width: 420px) {
  .site-nav { gap: 10px; font-size: 14px; }
  .site-nav .lang { display: none; }
}
</style>
