<template>
  <SiteShell :lang="lang" page="home" :title="t.title" :description="t.description">
    <section class="hero">
      <h1>{{ t.heading }}</h1>
      <p class="lede">{{ t.lede }}</p>
      <p class="actions">
        <a href="/login?signup=1" class="cta">{{ t.cta }}</a>
        <span class="works small">{{ t.works }}</span>
      </p>
    </section>
    <section class="points">
      <article v-for="p in t.points" :key="p.title" class="point">
        <h2>{{ p.title }}</h2>
        <p>{{ p.text }}</p>
      </article>
    </section>
  </SiteShell>
</template>

<script setup lang="ts">
import { SITE_BOOT, SITE_TEXT, type SiteLang } from '~/utils/site'

/** The website's home. JER-43 fills it in; this is the frame and the proposition. */
const props = defineProps<{ lang: SiteLang }>()
const t = computed(() => SITE_TEXT[props.lang].home)
useHead({ script: [{ innerHTML: SITE_BOOT, tagPosition: 'head' }] })
</script>

<style scoped>
.hero { padding: 8vh 0 6vh; max-width: 760px; }
h1 { font-size: clamp(34px, 7vw, 64px); line-height: 1.02; font-stretch: 125%; letter-spacing: -0.03em; margin: 0 0 20px; }
.lede { font-size: clamp(17px, 2.2vw, 20px); line-height: 1.5; color: var(--text-2); margin: 0 0 28px; max-width: 60ch; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin: 0; }
.cta { padding: 14px 22px; border-radius: 999px; background: var(--text); color: var(--bg); font-weight: 600; font-size: 17px; text-decoration: none; }
.works { color: var(--text-2); }
.small { font-size: 14px; }
.points { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.point { padding: 20px; border-radius: var(--radius); background: var(--surface); }
.point h2 { font-size: 18px; margin: 0 0 6px; }
.point p { margin: 0; color: var(--text-2); line-height: 1.5; font-size: 15px; }
</style>
