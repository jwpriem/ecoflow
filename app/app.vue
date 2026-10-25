<template>
  <div>
    <main><NuxtPage :transition="{ name: 'page', mode: 'out-in' }" /></main>
    <nav v-if="loggedIn" class="tabs" :aria-label="m.tabs.main">
      <NuxtLink v-for="t in tabs" :key="t.to" :to="t.to">
        <AppIcon :name="t.icon" />
        <span>{{ m.tabs[t.key] }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
const { loggedIn } = useAuth()
const { locale, m } = useLocale()
useHead({ htmlAttrs: { lang: locale } })
const tabs = [
  { to: '/', key: 'home', icon: 'house' },
  { to: '/savings', key: 'savings', icon: 'chart' },
  { to: '/plan', key: 'plan', icon: 'calendar' },
  { to: '/cars', key: 'cars', icon: 'car' },
  { to: '/settings', key: 'settings', icon: 'gear' },
] as const
</script>
