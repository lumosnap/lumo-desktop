<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

interface Props {
  show: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}

const props = withDefaults(defineProps<Props>(), {
  show: false,
  title: '',
  size: 'md'
})

const emit = defineEmits(['close'])

const close = () => {
  emit('close')
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl'
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="close"
    >
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 scale-95 translate-y-4"
        enter-to-class="opacity-100 scale-100 translate-y-0"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 scale-100 translate-y-0"
        leave-to-class="opacity-0 scale-95 translate-y-4"
      >
        <div
          v-if="show"
          class="w-full bg-[#1e1e23] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          :class="sizeClasses[size]"
        >
          <div
            v-if="title"
            class="px-6 py-4 border-b border-white/10 flex items-center justify-between"
          >
            <h3 class="text-lg font-semibold text-white">{{ title }}</h3>
            <button class="text-gray-400 hover:text-white transition-colors" @click="close">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>
          <div class="p-6">
            <slot />
          </div>
          <div
            v-if="$slots.footer"
            class="px-6 py-4 bg-black/20 border-t border-white/10 flex justify-end gap-3"
          >
            <slot name="footer" />
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>
