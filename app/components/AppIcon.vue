<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="filled ? 0 : 1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'battery'">
      <rect x="2.5" y="7" width="17" height="10" rx="3" />
      <path d="M21.5 10.5v3" />
      <path d="M11.5 9 9 12.5h3.5L10 15.5" />
    </template>
    <template v-else-if="name === 'chart'">
      <path d="M5 20V12M10 20V5M15 20v-6M20 20V9" />
    </template>
    <template v-else-if="name === 'calendar'">
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M8 14h2M14 14h2M8 17h2" />
    </template>
    <template v-else-if="name === 'gear'">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </template>
    <template v-else-if="name === 'grid'">
      <path d="M8 21 12 3l4 18M6.5 9h11M5 14h14M9.5 14 12 21l2.5-7" />
    </template>
    <template v-else-if="name === 'house'">
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v11h13V9" />
      <path d="M10 20v-5.5h4V20" />
    </template>
    <template v-else-if="name === 'bolt'">
      <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />
    </template>
    <template v-else-if="name === 'euro'">
      <path d="M17.5 6.5A6.5 6.5 0 1 0 17.5 17.5M4 10.5h9M4 13.5h9" />
    </template>
    <template v-else-if="name === 'leaf'">
      <path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15" />
      <path d="M5 19 13 11" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </template>
    <template v-else-if="name === 'nodes'">
      <circle cx="12" cy="4.5" r="2.2" /><circle cx="4.5" cy="12" r="2.2" /><circle cx="19.5" cy="12" r="2.2" /><circle cx="12" cy="19.5" r="2.2" />
      <path d="M12 6.7v10.6M6.7 12h10.6" />
    </template>
    <template v-else-if="name === 'wave'">
      <path d="M3 12h3l2.5-6 4 12 2.5-6h6" />
    </template>
    <template v-else-if="name === 'chevron'">
      <path d="m9 6 6 6-6 6" />
    </template>
    <template v-else-if="name === 'key'">
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2" />
    </template>
    <template v-else-if="name === 'sliders'">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </template>
    <template v-else-if="name === 'person'">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5" />
    </template>
    <template v-else-if="name === 'car'">
      <path d="M3 13.5 5 8a2 2 0 0 1 1.9-1.3h10.2A2 2 0 0 1 19 8l2 5.5" />
      <path d="M3 13.5h18V18a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1H6.5v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
      <path d="M6.5 16h0M17.5 16h0" />
    </template>
    <template v-else-if="name === 'plug'">
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0Z" />
      <path d="M12 17v5" />
    </template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{ name: string; filled?: boolean }>()
</script>
