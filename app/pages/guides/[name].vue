<template>
  <MarkdownPage :render="guideHtml" :title="m.guides.title" />
</template>

<script setup lang="ts">
const { m } = useLocale()
</script>
