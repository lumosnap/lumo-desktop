<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  type: 'button'
})

const baseClasses =
  'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-[var(--color-turquoise)] text-gray-900 shadow-[0_0_15px_rgba(0,224,198,0.3)] hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(0,224,198,0.5)] focus:ring-[var(--color-turquoise)] font-semibold'
    case 'secondary':
      return 'bg-[#262626] text-white border border-white/10 hover:bg-[#333333] focus:ring-gray-500'
    case 'ghost':
      return 'bg-transparent text-current hover:bg-white/5 focus:ring-gray-500'
    case 'outline':
      return 'bg-transparent border border-[var(--color-turquoise)] text-[var(--color-turquoise)] hover:bg-[var(--color-turquoise)]/10 focus:ring-[var(--color-turquoise)]'
    case 'danger':
      return 'bg-red-500/10 text-red-500 hover:bg-red-500/20 focus:ring-red-500'
    default:
      return ''
  }
})

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'h-8 px-3 text-xs'
    case 'md':
      return 'h-10 px-4 text-sm'
    case 'lg':
      return 'h-12 px-6 text-base'
    case 'icon':
      return 'h-10 w-10 p-2'
    default:
      return 'h-10 px-4 text-sm'
  }
})
</script>

<template>
  <button
    :type="type"
    :class="[baseClasses, variantClasses, sizeClasses]"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="mr-2">
      <svg
        class="animate-spin h-4 w-4 text-current"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="4"
        ></circle>
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    </span>
    <slot />
  </button>
</template>
