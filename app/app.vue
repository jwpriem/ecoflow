<template>
  <div class="shell" :class="{ authed: loggedIn }">
    <main><NuxtPage :transition="{ name: 'page', mode: 'out-in' }" /></main>
    <nav v-if="loggedIn" class="tabs" :aria-label="m.tabs.main">
      <!-- On a large screen the tab bar is a rail: logo on top, the batteries at the foot -->
      <NuxtLink to="/" class="rail-only rail-logo" aria-hidden="true" tabindex="-1">
        <img :src="`/brand/wattswise-logo-${sky === 'night' ? 'dark' : 'light'}.svg`" alt="WattsWise" />
      </NuxtLink>
      <NuxtLink v-for="t in tabs" :key="t.to" :to="t.to">
        <AppIcon :name="t.icon" />
        <span>{{ m.tabs[t.key] }}</span>
      </NuxtLink>
      <div class="rail-only rail-gap" />
      <RailNow />
    </nav>
  </div>
</template>

<script setup lang="ts">
const { loggedIn } = useAuth()
const { locale, m } = useLocale()
const sky = useState<'day' | 'night'>('sky', () => 'day')
useHead({ htmlAttrs: { lang: locale } })
const tabs = [
  { to: '/', key: 'home', icon: 'house' },
  { to: '/savings', key: 'savings', icon: 'chart' },
  { to: '/plan', key: 'plan', icon: 'calendar' },
  { to: '/cars', key: 'cars', icon: 'car' },
  { to: '/settings', key: 'settings', icon: 'gear' },
] as const
</script>
