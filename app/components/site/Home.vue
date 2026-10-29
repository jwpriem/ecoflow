<template>
  <SiteShell :lang="lang" page="home" :title="t.title" :description="t.description">
    <section class="hero">
      <div class="pitch">
        <h1>{{ t.heading }}</h1>
        <p class="lede">{{ t.lede }}</p>
        <p class="actions">
          <a href="/login?signup=1" class="cta">{{ t.cta }}</a>
        <a href="/login?demo=1" class="demo">{{ t.demo }}</a>
          <span class="works small">{{ t.works }}</span>
        </p>
      </div>
      <SitePriceDay :lang="lang" class="picture" />
    </section>
    <section class="points">
      <article v-for="p in t.points" :key="p.title" class="point">
        <h2>{{ p.title }}</h2>
        <p>{{ p.text }}</p>
      </article>
    </section>
    <section class="shots" aria-labelledby="shots">
      <h2 id="shots">{{ t.shotsHeading }}</h2>
      <div class="shot-row">
        <SiteShot v-for="s in t.shots" :key="s.title" :lang="lang" :title="s.title" :text="s.text" />
      </div>
    </section>
    <p class="more">
      <NuxtLink :to="sitePath('how', lang)">{{ t.more.how }}</NuxtLink>
      <NuxtLink :to="sitePath('devices', lang)">{{ t.more.devices }}</NuxtLink>
    </p>
  </SiteShell>
</template>

<script setup lang="ts">
import { SITE_BOOT, SITE_TEXT, type SiteLang, sitePath } from '~/utils/site'

/** The website's home: the proposition, an example day of prices, and what the app looks like. */
const props = defineProps<{ lang: SiteLang }>()
const t = computed(() => SITE_TEXT[props.lang].home)
useHead({ script: [{ innerHTML: SITE_BOOT, tagPosition: 'head' }] })
</script>

<style scoped>
.hero { display: grid; gap: 40px; align-items: end; padding: 7vh 0 8vh; }
@media (min-width: 900px) { .hero { grid-template-columns: 1.1fr 1fr; gap: 56px; } }
h1 { font-size: clamp(34px, 7vw, 64px); line-height: 1.02; font-stretch: 125%; letter-spacing: -0.03em; margin: 0 0 20px; }
.lede { font-size: clamp(17px, 2.2vw, 20px); line-height: 1.5; color: var(--text-2); margin: 0 0 28px; max-width: 60ch; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin: 0; }
.cta { padding: 14px 22px; border-radius: 999px; background: var(--text); color: var(--bg); font-weight: 600; font-size: 17px; text-decoration: none; }
.demo { padding: 12px 20px; border-radius: 999px; border: 2px solid var(--text); color: var(--text); font-weight: 600; font-size: 17px; text-decoration: none; }
.works { color: var(--text-2); flex-basis: 100%; }
.small { font-size: 14px; }
.points { display: grid; gap: 28px 40px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); padding-top: 28px; border-top: 1px solid var(--rule); }
.point h2 { font-size: 19px; font-stretch: 112%; margin: 0 0 6px; }
.point p { margin: 0; color: var(--text-2); line-height: 1.5; font-size: 15px; max-width: 42ch; }
.shots { margin-top: 72px; }
.shots h2 { font-size: clamp(24px, 4vw, 34px); font-stretch: 118%; letter-spacing: -0.02em; margin: 0 0 24px; }
.shot-row { display: grid; gap: 32px; grid-template-columns: repeat(2, minmax(0, 236px)); }
.more { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 56px 0 0; font-size: 17px; font-weight: 600; }
.more a { color: var(--text); }
</style>
