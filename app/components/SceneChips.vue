<template>
  <!-- Scenes from the Hue app for one room or group: one tap sets it. The row scrolls sideways when there are many. -->
  <div class="scenes" role="group" :aria-label="m.lights.scenes">
    <button v-for="s in scenes" :key="s.id" type="button" :class="{ on: s.active }" :aria-pressed="s.active" @click="emit('pick', s)">
      <span class="swatch" :style="{ background: sceneSwatch(s.colors) }" aria-hidden="true" />{{ s.name }}
    </button>
  </div>
</template>

<script setup lang="ts">
export type Scene = { id: string; name: string; groupId: string; colors: SceneColor[]; active: boolean }

defineProps<{ scenes: Scene[] }>()
const emit = defineEmits<{ pick: [Scene] }>()
const { m } = useLocale()
</script>

<style scoped>
.scenes { display: flex; gap: 8px; overflow-x: auto; padding: 2px; margin: -2px; scrollbar-width: none; }
.scenes::-webkit-scrollbar { display: none; }
button { flex: none; border-radius: 999px; padding: 6px 14px 6px 6px; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; white-space: nowrap; }
button.on { background: var(--text); color: var(--bg); border-color: var(--text); font-weight: 600; }
.swatch { width: 24px; height: 24px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }
</style>
