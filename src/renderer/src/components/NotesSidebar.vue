<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { X } from 'lucide-vue-next'
import PrivateNote from './PrivateNote.vue'

type Tab = 'client' | 'mine'

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
  loaded: boolean // the saved notes have arrived; until then there is nothing safe to edit
  loadError?: boolean
  saveNote: (imageId: number, body: string) => Promise<boolean>
  saveNoteNow: (imageId: number, body: string) => boolean
  state: 'open' | 'done' | null // null: no note yet, nothing to mark
  doneAt?: number
  busy: boolean
  locked: boolean
  openOn?: Tab // the tab to open on; the client's by default
}>()

const emit = defineEmits<{
  close: []
  toggleDone: []
  retry: []
}>()

const doneDate = computed(() =>
  props.doneAt
    ? new Date(props.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''
)

const closeBtn = ref<HTMLButtonElement>()
// Two tabs: what the client wrote (it comes first), and the photographer's own note with Done
const tab = ref<Tab>('client')
const tabIds: Tab[] = ['client', 'mine']
const tabEls = ref<HTMLButtonElement[]>([])
// ARIA tabs: arrows, Home and End move between the tabs and open them
function onTabKey(e: KeyboardEvent): void {
  const i = tabIds.indexOf(tab.value)
  const to =
    e.key === 'ArrowRight' || e.key === 'ArrowLeft'
      ? (i + 1) % 2
      : e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? 1
          : -1
  if (to < 0) return
  e.preventDefault()
  tab.value = tabIds[to]
  tabEls.value[to]?.focus()
}
// Bound to the photo's id now: the note still saves to it after the panel closes
const saveFor =
  (id: number) =>
  (body: string): Promise<boolean> =>
    props.saveNote(id, body)
const saveNowFor =
  (id: number) =>
  (body: string): boolean =>
    props.saveNoteNow(id, body)
// Each opening, and each photo, starts on the tab the opener asked for
watch(
  () => [props.isOpen, props.image?.id, props.openOn],
  () => (tab.value = props.openOn ?? 'client'),
  { immediate: true }
)
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
    <!-- The panel sits outside the lightbox. PhotoSwipe's focus trap listens for focusin on the
         document and pulls focus back to itself (changing its trapFocus option after it opens
         does nothing), so focus inside the panel stops here and the note box keeps it. -->
    <aside v-if="isOpen" class="notes" role="dialog" aria-label="Notes" @focusin.stop>
      <header>
        <div>
          <h2>Notes</h2>
          <small>{{ image?.originalFilename }}</small>
        </div>
        <button ref="closeBtn" class="icon-btn sm" aria-label="Close notes" @click="emit('close')">
          <X />
        </button>
      </header>
      <div class="ntabs seg" role="tablist" aria-label="Whose notes" @keydown="onTabKey">
        <button
          v-for="t in tabIds"
          :id="`nt-${t}`"
          :key="t"
          ref="tabEls"
          role="tab"
          :aria-selected="tab === t"
          :aria-controls="`np-${t}`"
          :tabindex="tab === t ? 0 : -1"
          @click="tab = t"
        >
          <template v-if="t === 'client'"
            >Client
            <span v-if="filteredComments.length" class="n num">{{
              filteredComments.length
            }}</span></template
          >
          <template v-else
            >Your notes<span v-if="note.trim()" class="dot" aria-label="(has a note)"></span
          ></template>
        </button>
      </div>
      <div
        v-show="tab === 'client'"
        id="np-client"
        class="list"
        role="tabpanel"
        aria-labelledby="nt-client"
      >
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
      <!-- Kept mounted while the client tab shows, so a half-typed note isn't lost -->
      <div
        v-show="tab === 'mine'"
        id="np-mine"
        class="list"
        role="tabpanel"
        aria-labelledby="nt-mine"
      >
        <!-- Done first: an on/off state of the photo, not a save button. D does the same. -->
        <div class="done-row">
          <button
            class="sw"
            role="switch"
            :aria-checked="state === 'done'"
            :disabled="!state || locked"
            :aria-busy="busy"
            aria-keyshortcuts="D"
            @click="emit('toggleDone')"
          >
            <span class="track"><span class="knob"></span></span>Done
          </button>
          <span v-if="busy" class="spin"></span>
          <span class="hint num">
            <template v-if="!state">Nothing to mark yet</template>
            <template v-else-if="state === 'done'">Marked {{ doneDate }}</template>
            <template v-else>Press <kbd>D</kbd></template>
          </span>
        </div>
        <!-- Only once the saved note is here: the box would start empty and save over it -->
        <p v-if="loadError" class="none bad">
          Couldn't load your notes. <button class="link" @click="emit('retry')">Try again</button>
        </p>
        <p v-else-if="!loaded" class="none" aria-busy="true"><span class="spin"></span></p>
        <!-- Keyed, so moving to another photo saves the note of the one before -->
        <PrivateNote
          v-else-if="image"
          :key="image.id"
          :value="note"
          label="Your note"
          placeholder="Retouch, print size, who to send it to…"
          :save="saveFor(image.id)"
          :save-now="saveNowFor(image.id)"
        />
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.ntabs {
  margin: 0 16px 16px;
}
.ntabs button {
  flex: 1;
  justify-content: center;
}
.ntabs .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand);
}
.none {
  margin: 0;
  padding: 0 8px;
  font-size: 13px;
  color: var(--ink-2);
}
.none.bad {
  color: var(--bad);
}
#np-mine {
  padding: 0 24px;
  gap: 16px;
}
.done-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.done-row .spin {
  width: 12px;
  height: 12px;
}
.done-row .hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-3);
}
.done-row kbd {
  font: inherit;
  padding: 0 5px;
  border: 1px solid var(--line-2);
  border-radius: 4px;
}
/* A switch: off is a grey track, on is the ok green with the knob across. Says a state, not an action. */
.sw {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: none;
  padding: 4px 0;
  font-size: 14px;
  color: var(--ink);
}
.sw .track {
  width: 36px;
  height: 22px;
  border-radius: 99px;
  background: var(--line-2);
  padding: 2px;
  transition: background 0.15s var(--ease);
}
.sw .knob {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 2px oklch(0% 0 0 / 0.25);
  transition: transform 0.18s var(--spring);
}
.sw[aria-checked='true'] .track {
  background: var(--ok);
}
.sw[aria-checked='true'] .knob {
  transform: translateX(14px);
}
.sw:disabled {
  cursor: default;
  color: var(--ink-3);
}
.sw:disabled .track {
  opacity: 0.5;
}
@media (prefers-reduced-motion: reduce) {
  .sw .track,
  .sw .knob {
    transition: none;
  }
}
</style>
