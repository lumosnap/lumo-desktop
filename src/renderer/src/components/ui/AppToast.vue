<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'
import { current, dismissToast } from '../../composables/useToast'

// A save that fails inside a dialog (Modal, the pick view) is said where the photographer is
// looking, with a "Try again" that works. An open modal dialog makes the rest of the page inert,
// so the toast goes inside it; as a popover it is in the top layer, over the dialog and over the
// lightbox. Chosen after the DOM updates, so a dialog that closes in the same tick is passed by.
// ponytail: the last open modal in document order is taken as the top one.
const host = ref<HTMLElement | 'body'>('body')
function place(): void {
  const d = [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')].at(-1)
  host.value = d ?? 'body'
  d?.addEventListener('close', () => (host.value = 'body'), { once: true })
}
watch(current, place, { flush: 'post' })
// A dialog taken out by v-if (Esc with @cancel.prevent) sends no close: notice it is gone
const gone = new MutationObserver(() => {
  if (host.value !== 'body' && !host.value.isConnected) place()
})
watch(host, (h) => {
  gone.disconnect()
  if (h !== 'body') gone.observe(document.body, { childList: true, subtree: true })
})
// A dialog opened while a toast is up takes the toast along, so its "Try again" stays usable
onMounted(() => document.addEventListener('toggle', onToggle, true))
onUnmounted(() => {
  document.removeEventListener('toggle', onToggle, true)
  gone.disconnect()
})
function onToggle(e: Event): void {
  if (current.value && e.target instanceof HTMLDialogElement && e.target.open) place()
}

const el = ref<HTMLElement>()
watch(
  [el, current, host],
  ([t]) => {
    if (!t?.isConnected) return // its dialog was closed and removed
    // Shown again for each toast and after each move, so it is on top of what opened since
    if (t.matches(':popover-open')) t.hidePopover()
    t.showPopover()
  },
  { flush: 'post' }
)

function act(): void {
  current.value?.action?.run()
  dismissToast()
}
</script>

<template>
  <Teleport :to="host">
    <div v-if="current" ref="el" class="toast" role="status" popover="manual">
      {{ current.msg }}
      <button v-if="current.action" class="link" @click="act">{{ current.action.label }}</button>
      <button class="icon-btn" aria-label="Dismiss" @click="dismissToast"><X /></button>
    </div>
  </Teleport>
</template>
