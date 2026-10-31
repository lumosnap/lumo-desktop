<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { current, dismissToast } from '../../composables/useToast'

function act(): void {
  current.value?.action?.run()
  dismissToast()
}
</script>

<template>
  <div v-if="current" class="toast" role="status">
    {{ current.msg }}
    <button v-if="current.action" class="link" @click="act">{{ current.action.label }}</button>
    <button class="icon-btn" aria-label="Dismiss" @click="dismissToast"><X /></button>
  </div>
</template>
