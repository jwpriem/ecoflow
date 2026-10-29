<template>
  <!-- The public website (pages/(site)) brings its own header and footer -->
  <NuxtPage v-if="isSite" />
  <div v-else class="shell" :class="{ authed: tabsOn }">
    <main><VerifyBanner v-if="loggedIn" /><ConsentBanner v-if="loggedIn" /><NuxtPage :transition="{ name: 'page', mode: 'out-in' }" /></main>
    <nav v-if="tabsOn" class="tabs" :aria-label="m.tabs.main">
      <!-- On a large screen the tab bar is a rail: logo on top, the batteries at the foot -->
      <NuxtLink to="/app" class="rail-only rail-logo" aria-hidden="true" tabindex="-1">
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
const { loggedIn, experimental, loadMe } = useAuth()
const { locale, m } = useLocale()
const sky = useState<'day' | 'night'>('sky', () => 'day')
const route = useRoute()
const isSite = computed(() => !!route.meta.site)
// The website pages set their own language, from the URL
useHead({ htmlAttrs: { lang: () => (isSite.value ? undefined : locale.value) } })
const ALL_TABS = [
  { to: '/app', key: 'home', icon: 'house' },
  { to: '/savings', key: 'savings', icon: 'chart' },
  { to: '/plan', key: 'plan', icon: 'calendar' },
  { to: '/cars', key: 'cars', icon: 'car', experimental: true },
  { to: '/settings', key: 'settings', icon: 'gear' },
] as const
// The Cars tab only for a household with the experimental integrations on
const tabs = computed(() => ALL_TABS.filter((t) => !('experimental' in t) || experimental.value))
// No tab bar while a new household is set up
const tabsOn = computed(() => loggedIn.value && route.path !== '/onboarding')
watch(loggedIn, (on) => on && loadMe().catch(() => undefined), { immediate: true })
</script>
