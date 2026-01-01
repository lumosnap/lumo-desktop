<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'

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
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
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
          class="w-full bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
          :class="sizeClasses[size]"
        >
          <div
            v-if="title"
            class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50"
          >
            <h3 class="text-lg font-semibold text-slate-900">{{ title }}</h3>
            <button
              class="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              @click="close"
            >
              <X class="h-5 w-5" />
            </button>
          </div>
          <div class="p-6">
            <slot />
          </div>
          <div
            v-if="$slots.footer"
            class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3"
          >
            <slot name="footer" />
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>
