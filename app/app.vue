<template>
  <div>
    <main><NuxtPage /></main>
    <nav v-if="loggedIn" class="tabs">
      <NuxtLink to="/">Batteries</NuxtLink>
      <NuxtLink to="/savings">Savings</NuxtLink>
      <NuxtLink to="/plan">Plan</NuxtLink>
      <NuxtLink to="/settings">Settings</NuxtLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
const { loggedIn } = useAuth()
</script>
