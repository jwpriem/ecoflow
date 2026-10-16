<template>
  <div ref="root" class="segmented" :class="{ full }" role="tablist">
    <div class="thumb" :style="thumb" />
    <button
      v-for="o in options" :key="String(o.value)" type="button" role="tab"
      :aria-selected="o.value === modelValue" :class="{ active: o.value === modelValue }"
      @click="emit('update:modelValue', o.value)"
    >{{ o.label }}</button>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number">
const props = defineProps<{ options: readonly { value: T; label: string }[]; modelValue: T; full?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [T] }>()
const root = ref<HTMLElement>()
const thumb = ref<Record<string, string>>({ opacity: '0' })

function place() {
  const i = props.options.findIndex((o) => o.value === props.modelValue)
  const btn = root.value?.querySelectorAll('button')[i] as HTMLElement | undefined
  if (!btn) return (thumb.value = { opacity: '0' })
  thumb.value = { width: `${btn.offsetWidth}px`, transform: `translateX(${btn.offsetLeft - 2}px)` }
}
let ro: ResizeObserver | undefined
onMounted(() => {
  place()
  ro = new ResizeObserver(place)
  ro.observe(root.value!)
})
onBeforeUnmount(() => ro?.disconnect())
watch(() => props.modelValue, () => nextTick(place))
</script>
