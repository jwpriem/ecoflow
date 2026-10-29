<template>
  <SiteShell :lang="lang" page="devices" :title="t.title" :description="t.description">
    <header class="intro">
      <h1>{{ t.heading }}</h1>
      <p class="lede">{{ t.lede }}</p>
    </header>
    <dl class="brands">
      <div v-for="b in t.brands" :key="b.name" class="brand">
        <dt><span class="name">{{ b.name }}</span> <span class="need" :class="{ optional: b.need === t.brands[2].need }">{{ b.need }}</span></dt>
        <dd>{{ b.text }}</dd>
      </div>
    </dl>
    <section class="models" aria-labelledby="models">
      <h2 id="models">{{ t.modelsHeading }}</h2>
      <ul>
        <li v-for="m in t.models" :key="m">{{ m }}</li>
      </ul>
    </section>
    <section class="more">
      <h2>{{ t.moreTitle }}</h2>
      <p>{{ t.moreText }} <a href="mailto:hello@wattswise.eu">hello@wattswise.eu</a></p>
    </section>
  </SiteShell>
</template>

<script setup lang="ts">
import { SITE_TEXT, type SiteLang } from '~/utils/site'

/** Supported devices: what WattsWise needs, what is optional, and the STREAM models. */
const props = defineProps<{ lang: SiteLang }>()
const t = computed(() => SITE_TEXT[props.lang].devices)
</script>

<style scoped>
.intro { padding: 6vh 0 4vh; max-width: 720px; }
h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.04; font-stretch: 125%; letter-spacing: -0.03em; margin: 0 0 16px; }
.lede { font-size: 18px; line-height: 1.5; color: var(--text-2); margin: 0; max-width: 58ch; }
.brands { margin: 0; max-width: 760px; }
.brand { padding: 22px 0; border-top: 1px solid var(--rule); }
.brand dt { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 6px; }
.name { font-size: 24px; font-weight: 700; font-stretch: 118%; }
.need { font-size: 13px; font-weight: 600; color: var(--cheap); }
.need.optional { color: var(--text-2); }
.brand dd { margin: 0; color: var(--text-2); line-height: 1.55; max-width: 58ch; }
.models { margin-top: 32px; }
h2 { font-size: 20px; font-stretch: 112%; margin: 0 0 12px; }
.models ul { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
.models li { padding: 6px 12px; border-radius: 999px; background: var(--surface); font-size: 15px; }
.more { margin-top: 48px; max-width: 58ch; }
.more p { margin: 0; color: var(--text-2); line-height: 1.55; }
.more a { color: var(--text); }
</style>
