<template>
  <!-- A whole number that runs up to its value when it appears, and follows it when it changes -->
  <span>{{ Math.round(shown) }}</span>
</template>

<script setup lang="ts">
const props = defineProps<{ value: number; stiffness?: number; delay?: number }>()
const shown = useTweened(() => props.value, { stiffness: props.stiffness, delay: props.delay })
</script>
