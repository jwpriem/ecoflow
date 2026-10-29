<template>
  <figure class="shot">
    <!-- A screenshot of the demo household (JER-40), in the page's language -->
    <img v-if="src" class="screen" :src="src" :alt="title" width="472" height="1022" loading="lazy" decoding="async" />
    <!-- A stand-in, for a screenshot that isn't there yet -->
    <div v-else class="frame" role="img" :aria-label="`${t.mark}: ${title}. ${t.note}`">
      <span class="mark small">{{ t.mark }}</span>
      <span class="hint small">{{ t.note }}</span>
    </div>
    <figcaption>
      <strong>{{ title }}</strong>
      <span class="muted">{{ text }}</span>
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { SITE_TEXT, type SiteLang } from '~/utils/site'

const props = defineProps<{ lang: SiteLang; title: string; text: string; src?: string }>()
const t = computed(() => SITE_TEXT[props.lang].shot)
</script>

<style scoped>
.shot { margin: 0; }
.screen, .frame { width: 100%; max-width: 236px; border-radius: 28px; }
.screen { display: block; height: auto; border: 6px solid var(--text); background: var(--bg); }
.frame {
  aspect-ratio: 9 / 16; max-height: 420px;
  border: 2px dashed var(--rule); background: var(--fill-2);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 20px; text-align: center;
}
.mark { padding: 2px 10px; border-radius: 999px; border: 2px solid var(--sun); color: var(--text); font-weight: 700; }
.hint { color: var(--text-2); max-width: 20ch; }
figcaption { display: flex; flex-direction: column; gap: 2px; margin-top: 12px; max-width: 30ch; font-size: 15px; line-height: 1.45; }
.small { font-size: 13px; }
.muted { color: var(--text-2); }
</style>
