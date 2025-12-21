<script setup lang="ts">
interface Props {
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

withDefaults(defineProps<Props>(), {
  hover: false,
  padding: 'md'
})

const paddingClasses = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8'
}
</script>

<template>
  <div
    class="backdrop-blur-xl bg-white/5 border border-white/10 rounded-xl transition-all duration-300"
    :class="[
      paddingClasses[padding],
      hover ? 'hover:-translate-y-1 hover:shadow-[0_12px_40px_0_rgba(0,0,0,0.45)]' : ''
    ]"
  >
    <slot />
  </div>
</template>
