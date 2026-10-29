<template>
  <MarkdownPage :render="legalHtml" :title="m.legal.title" />
</template>

<script setup lang="ts">
const { m } = useLocale()
</script>
