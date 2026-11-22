<template>
  <!-- The parts of Settings, the same list as in the account menu -->
  <div v-stagger>
    <header class="page-head"><h1>{{ m.settings.title }}</h1></header>
    <div class="list">
      <NuxtLink v-for="s in sections" :key="s" :to="`/settings/${s}`" class="list-row indent">
        <span class="lead">
          <span class="icon-tile"><AppIcon :name="SETTINGS_ICONS[s]" /></span>
          <span class="stack-text"><span class="title">{{ m.settings.sections[s] }}</span><span class="small muted">{{ m.settings.sectionHelp[s] }}</span></span>
        </span>
        <AppIcon name="chevron" class="chev" />
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SETTINGS_ICONS, legacySettingsPath, visibleSettingsSections } from '~/utils/settingsSections'

const { m } = useLocale()
const { me, experimental } = useAuth()
const route = useRoute()
const sections = computed(() => visibleSettingsSections({ experimental: experimental.value, owner: me.value?.member === 'owner' }))

// Links from before Settings was split (/settings#cars, a sign-in coming back with ?hue=ok) go to their page
const to = legacySettingsPath(route.hash, route.query)
if (to) await navigateTo({ path: to.split('#')[0], hash: to.includes('#') ? `#${to.split('#')[1]}` : '', query: route.query }, { replace: true })
</script>

<style scoped>
.list { max-width: 640px; }
.list-row { color: var(--text); text-decoration: none; }
.list-row:hover { background: var(--fill-2); }
.stack-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.chev { width: 16px; height: 16px; color: var(--muted); flex: none; }
</style>
