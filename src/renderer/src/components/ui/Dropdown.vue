<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

defineProps<{
  align?: 'left' | 'right'
  disabled?: boolean
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
    <div @click="!disabled && toggle()">
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
        v-if="isOpen && !disabled"
        class="absolute z-[100] mt-2 w-auto min-w-48 overflow-hidden rounded-xl bg-white shadow-xl shadow-slate-200/50 ring-1 ring-slate-200 focus:outline-none"
        :class="[align === 'right' ? 'right-0' : 'left-0']"
      >
        <div class="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
          <slot name="content" :close="close"></slot>
        </div>
      </div>
    </transition>
  </div>
</template>
