<template>
  <div>
    <NuxtLink to="/settings" class="back small">‹ {{ m.settings.title }}</NuxtLink>
    <header class="page-head"><h1>{{ m.settings.sections[section] }}</h1></header>
    <SettingsView :key="section" :section="section" />
  </div>
</template>

<script setup lang="ts">
import { isSettingsSection, type SettingsSection } from '~/utils/settingsSections'

definePageMeta({ validate: (route) => isSettingsSection(route.params.section) })

const { m } = useLocale()
const route = useRoute()
const section = computed(() => route.params.section as SettingsSection)
</script>

<style scoped>
.back { display: inline-block; margin-bottom: 8px; color: var(--text-2); text-decoration: none; }
</style>
