<script setup lang="ts">
import { ref, watch, onMounted, nextTick, useId } from 'vue'
import { X } from 'lucide-vue-next'

// Native <dialog>: Esc, focus trap and top layer come free.
const props = defineProps<{ show: boolean; title: string; sub?: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const el = ref<HTMLDialogElement>()
// The title names the dialog for screen readers
const titleId = useId()

async function sync(): Promise<void> {
  const d = el.value
  if (!d) return
  if (props.show && !d.open) {
    d.showModal()
    await nextTick()
    d.querySelector<HTMLElement>('[autofocus]')?.focus()
  } else if (!props.show && d.open) d.close()
}
watch(() => props.show, sync)
onMounted(sync)

function onClick(e: MouseEvent): void {
  if (e.target === el.value) emit('close')
}
</script>

<template>
  <dialog
    ref="el"
    :aria-labelledby="titleId"
    :style="wide ? 'width:540px' : ''"
    @click="onClick"
    @cancel.prevent="emit('close')"
  >
    <template v-if="show">
      <div class="dlg-h">
        <div>
          <h2 :id="titleId">{{ title }}</h2>
          <small v-if="sub">{{ sub }}</small>
        </div>
        <button class="icon-btn sm plain" aria-label="Close" @click="emit('close')"><X /></button>
      </div>
      <div class="dlg-b"><slot /></div>
      <div v-if="$slots.footer" class="dlg-f"><slot name="footer" /></div>
    </template>
  </dialog>
</template>
