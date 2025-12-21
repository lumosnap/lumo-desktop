<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  modelValue: string | number
  type?: string
  placeholder?: string
  label?: string
  error?: string
  id?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  placeholder: '',
  label: '',
  error: '',
  id: () => `input-${Math.random().toString(36).substr(2, 9)}`
})

const emit = defineEmits(['update:modelValue'])

const value = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="text-sm font-medium text-gray-300">
      {{ label }}
    </label>
    <input
      :id="id"
      v-model="value"
      :type="type"
      :placeholder="placeholder"
      class="w-full bg-[#262626] border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/40 transition-all duration-200 focus:outline-none focus:border-[#2DD4BF] focus:ring-2 focus:ring-[#2DD4BF]/20 disabled:opacity-50 disabled:cursor-not-allowed"
      :class="{ 'border-red-500 focus:border-red-500 focus:ring-red-500/20': error }"
    />
    <span v-if="error" class="text-xs text-red-500">{{ error }}</span>
  </div>
</template>
