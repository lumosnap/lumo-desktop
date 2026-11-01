<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted, useId } from 'vue'
import { Check, EyeOff } from 'lucide-vue-next'
import { useAutosave } from '../composables/useAutosave'
import { toast } from '../composables/useToast'

// The photographer's own note, saved on this computer as they type. Never sent to the client.
const props = defineProps<{
  value: string
  label: string
  placeholder: string
  save: (body: string) => Promise<boolean>
  saveNow: (body: string) => boolean // blocking, for the window closing
  autofocus?: boolean
}>()

const id = useId()
const body = ref(props.value)
const { status, edit, flush, dirty } = useAutosave(props.save)
const el = ref<HTMLTextAreaElement>()

function grow(): void {
  const t = el.value
  if (!t) return
  t.style.height = 'auto'
  t.style.height = `${Math.min(t.scrollHeight, 240)}px`
}
function onInput(): void {
  edit(body.value)
  grow()
}
// The window is closing (quit): an async save may not land before the DB closes, so block on it
const saveOnUnload = (): void => {
  if (dirty()) props.saveNow(body.value)
}
onMounted(() => {
  grow()
  if (props.autofocus) el.value?.focus()
  addEventListener('beforeunload', saveOnUnload)
})
// Closing the panel or moving to another photo saves what was typed; a failure says so
onBeforeUnmount(async () => {
  removeEventListener('beforeunload', saveOnUnload)
  const save = props.save
  const text = body.value
  if (!(await flush()))
    toast("Couldn't save your note", { label: 'Try again', run: () => void retry(save, text) })
})
async function retry(save: (b: string) => Promise<boolean>, text: string): Promise<void> {
  const ok = await save(text).catch(() => false)
  toast(
    ok ? 'Note saved' : "Couldn't save your note",
    ok ? undefined : { label: 'Try again', run: () => void retry(save, text) }
  )
}
defineExpose({ flush })
</script>

<template>
  <div class="pnote" :class="status">
    <label :for="id" class="pnote-l">{{ label }}</label>
    <textarea
      :id="id"
      ref="el"
      v-model="body"
      class="input"
      rows="2"
      maxlength="5000"
      :placeholder="placeholder"
      :aria-describedby="`${id}-s`"
      @input="onInput"
      @blur="flush"
    ></textarea>
    <div :id="`${id}-s`" class="pnote-s" aria-live="polite">
      <template v-if="status === 'saving'"><span class="spin"></span></template>
      <template v-else-if="status === 'saved'"><Check />Saved. Only you see this.</template>
      <template v-else-if="status === 'error'">
        Couldn't save. <button class="link" @click="flush">Try again</button>
      </template>
      <template v-else><EyeOff />Only you see this. Not your client.</template>
    </div>
  </div>
</template>

<style scoped>
.pnote {
  display: grid;
  gap: 6px;
}
.pnote-l {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
}
.pnote-l svg,
.pnote-s svg {
  width: 14px;
  height: 14px;
}
/* A writing surface, not a form field: no fixed height, reads like the note it is */
/* Card-white with a drawn edge, so it reads as a place to write, not a greyed-out field */
.pnote textarea {
  cursor: text;
  background-color: var(--card);
  border-color: var(--line-2);
  height: auto;
  min-height: 64px;
  padding: 10px 14px;
  resize: none;
  line-height: 1.45;
  font: inherit;
  font-size: 14px;
}
.pnote-s {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
  font-size: 12px;
  color: var(--ink-3);
}
.pnote textarea:hover {
  border-color: var(--ink-3);
}
/* Scoped rules outrank .input:focus, so the focus edge is restated here */
.pnote textarea:focus {
  border-color: var(--brand);
}
.pnote textarea::placeholder {
  color: var(--ink-3);
}
.pnote-s .spin {
  width: 12px;
  height: 12px;
}
.pnote.error .pnote-s {
  color: var(--bad);
}
</style>
