<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  align?: 'left' | 'right'
}>()

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

function toggle() {
  isOpen.value = !isOpen.value
}

function close() {
  isOpen.value = false
}

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div ref="dropdownRef" class="relative inline-block text-left">
    <div @click="toggle">
      <slot name="trigger"></slot>
    </div>

    <transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        class="absolute z-50 mt-2 w-48 rounded-xl bg-[#1e1e2d] shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none border border-white/10"
        :class="[align === 'right' ? 'right-0' : 'left-0']"
      >
        <div class="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
          <slot name="content" :close="close"></slot>
        </div>
      </div>
    </transition>
  </div>
</template>
