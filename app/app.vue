<template>
  <div>
    <main><NuxtPage :transition="{ name: 'page', mode: 'out-in' }" /></main>
    <nav v-if="loggedIn" class="tabs" aria-label="Main">
      <NuxtLink v-for="t in tabs" :key="t.to" :to="t.to">
        <AppIcon :name="t.icon" />
        <span>{{ t.label }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
const { loggedIn } = useAuth()
const tabs = [
  { to: '/', label: 'Home', icon: 'house' },
  { to: '/savings', label: 'Savings', icon: 'chart' },
  { to: '/plan', label: 'Plan', icon: 'calendar' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
]
useHead({ meta: [{ name: 'theme-color', content: '#000000' }, { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }] })
</script>
