<template>
  <SiteShell :lang="lang" page="how" :title="t.title" :description="t.description">
    <header class="intro">
      <h1>{{ t.heading }}</h1>
      <p class="lede">{{ t.lede }}</p>
    </header>
    <ol class="steps">
      <li v-for="s in t.steps" :key="s.title">
        <h2>{{ s.title }}</h2>
        <p>{{ s.text }}</p>
      </li>
    </ol>
    <section class="modes" aria-labelledby="modes">
      <h2 id="modes">{{ t.modesHeading }}</h2>
      <p class="lede">{{ t.modesLede }}</p>
      <div class="mode-row">
        <article v-for="(m, i) in t.modes" :key="m.title" class="mode" :class="i ? 'steer' : 'watch'">
          <h3>{{ m.title }}</h3>
          <p>{{ m.text }}</p>
        </article>
      </div>
    </section>
    <p class="actions"><a href="/login?signup=1" class="cta">{{ t.cta }}</a></p>
  </SiteShell>
</template>

<script setup lang="ts">
import { SITE_TEXT, type SiteLang } from '~/utils/site'

/** How it works: from connecting the accounts to the euros, and the choice between watching and steering. */
const props = defineProps<{ lang: SiteLang }>()
const t = computed(() => SITE_TEXT[props.lang].how)
</script>

<style scoped>
.intro { padding: 6vh 0 4vh; max-width: 720px; }
h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.04; font-stretch: 125%; letter-spacing: -0.03em; margin: 0 0 16px; }
.lede { font-size: 18px; line-height: 1.5; color: var(--text-2); margin: 0; max-width: 58ch; }
/* A real sequence, so it is numbered; the numbers sit on a line that runs from the first step to the last */
.steps { list-style: none; counter-reset: step; margin: 0; padding: 0; max-width: 720px; }
.steps li { counter-increment: step; position: relative; padding: 0 0 32px 56px; }
.steps li::before {
  content: counter(step); position: absolute; left: 0; top: -2px; width: 36px; height: 36px; border-radius: 50%;
  display: grid; place-items: center; background: var(--text); color: var(--bg); font-weight: 700; font-variant-numeric: tabular-nums;
}
.steps li:not(:last-child)::after { content: ''; position: absolute; left: 17px; top: 40px; bottom: 4px; width: 2px; background: var(--rule); }
.steps h2 { font-size: 20px; font-stretch: 112%; margin: 4px 0 6px; }
.steps p { margin: 0; color: var(--text-2); line-height: 1.55; max-width: 56ch; }
.modes { margin-top: 48px; }
.modes h2 { font-size: clamp(24px, 4vw, 34px); font-stretch: 118%; letter-spacing: -0.02em; margin: 0 0 10px; }
.mode-row { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 24px; }
.mode { padding: 20px 22px; border-radius: var(--radius); background: var(--surface); border-left: 4px solid var(--hold); }
.mode.steer { border-left-color: var(--cheap); }
.mode h3 { font-size: 18px; margin: 0 0 6px; }
.mode p { margin: 0; color: var(--text-2); line-height: 1.5; font-size: 15px; }
.actions { margin: 40px 0 0; }
.cta { display: inline-block; padding: 14px 22px; border-radius: 999px; background: var(--text); color: var(--bg); font-weight: 600; font-size: 17px; text-decoration: none; }
</style>
