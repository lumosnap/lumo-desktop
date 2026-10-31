<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { X, Check } from 'lucide-vue-next'
import PrivateNote from './PrivateNote.vue'

interface Comment {
  clientName: string
  notes: string | null
  createdAt: string
}

interface Image {
  id: number
  originalFilename: string
  localFilePath: string
  comments?: Comment[]
}

const props = defineProps<{
  isOpen: boolean
  image: Image | null
  note: string
  saveNote: (imageId: number, body: string) => Promise<boolean>
  state: 'open' | 'done' | null // null: no note yet, nothing to mark
  doneAt?: number
  busy: boolean
  locked: boolean
}>()

const emit = defineEmits<{
  close: []
  toggleDone: []
}>()

const doneDate = computed(() =>
  props.doneAt
    ? new Date(props.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''
)

const closeBtn = ref<HTMLButtonElement>()
// Bound to the photo's id now: the note still saves to it after the panel closes
const saveFor =
  (id: number) =>
  (body: string): Promise<boolean> =>
    props.saveNote(id, body)
watch(
  () => props.isOpen,
  async (open) => {
    if (!open) return
    await nextTick()
    closeBtn.value?.focus()
  }
)

// Only comments that carry a note
const filteredComments = computed(() => {
  if (!props.image?.comments) return []
  return props.image.comments.filter((c) => c.notes && c.notes.trim().length > 0)
})

const initials = (s: string): string =>
  s
    .split(/\s|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })
}
</script>

<template>
  <Teleport to="body">
    <aside v-if="isOpen" class="notes" role="dialog" aria-label="Notes">
      <header>
        <div>
          <h2>Notes</h2>
          <small>{{ image?.originalFilename }}</small>
        </div>
        <button ref="closeBtn" class="icon-btn sm" aria-label="Close notes" @click="emit('close')">
          <X />
        </button>
      </header>
      <div class="list">
        <!-- Yours first: it is what the photographer writes here. Keyed, so moving to another
             photo saves the note of the one before. -->
        <PrivateNote
          v-if="image"
          :key="image.id"
          class="mine"
          :value="note"
          label="Your note"
          placeholder="Retouch, print size, who to send it to…"
          :save="saveFor(image.id)"
        />
        <div class="from">From your client</div>
        <template v-if="filteredComments.length">
          <div v-for="(comment, index) in filteredComments" :key="index" class="note">
            <div class="h">
              <span class="avatar">{{ initials(comment.clientName) }}</span>
              {{ comment.clientName }}
              <small>{{ formatDate(comment.createdAt) }}</small>
            </div>
            <p>{{ comment.notes }}</p>
          </div>
        </template>
        <p v-else class="none">No notes from your client. They add them from their link.</p>
      </div>
      <!-- Done closes the loop on this photo's notes; D does the same from the keyboard -->
      <footer v-if="state" class="done-row">
        <span v-if="state === 'done'" class="num"><Check class="ok" />Done {{ doneDate }}</span>
        <span v-else-if="filteredComments.length" class="num">
          {{ filteredComments.length }} note{{ filteredComments.length > 1 ? 's' : '' }} from your
          client
        </span>
        <button
          class="btn sm"
          :class="state === 'done' ? 'ghost' : 'primary'"
          :disabled="locked"
          :aria-busy="busy"
          aria-keyshortcuts="D"
          @click="emit('toggleDone')"
        >
          <span v-if="busy" class="spin"></span>{{ state === 'done' ? 'Reopen' : 'Mark done'
          }}<kbd>D</kbd>
        </button>
      </footer>
    </aside>
  </Teleport>
</template>

<style scoped>
.mine {
  padding: 0 8px 16px;
  border-bottom: 1px solid var(--line);
}
.from {
  padding: 8px 8px 0;
  font-size: 13px;
  color: var(--ink-3);
}
.none {
  margin: 0;
  padding: 0 8px;
  font-size: 13px;
  color: var(--ink-2);
}
.done-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.done-row > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.done-row .ok {
  width: 16px;
  height: 16px;
  color: var(--ok);
}
.done-row .btn {
  margin-left: auto;
}
.done-row kbd {
  margin-left: 4px;
  font: inherit;
  font-size: 11px;
  opacity: 0.6;
}
</style>
