<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { X } from 'lucide-vue-next'

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
}>()

const emit = defineEmits<{
  close: []
}>()

const closeBtn = ref<HTMLButtonElement>()
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
    <aside v-if="isOpen" class="notes" role="dialog" aria-label="Client notes">
      <header>
        <div>
          <h2>Client notes</h2>
          <small>{{ image?.originalFilename }}</small>
        </div>
        <button ref="closeBtn" class="icon-btn sm" aria-label="Close notes" @click="emit('close')">
          <X />
        </button>
      </header>
      <div class="list">
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
        <div v-else class="empty" style="padding: 64px 8px">
          <p>No notes on this photo. Clients add them from their link.</p>
        </div>
      </div>
      <footer class="num">
        {{
          filteredComments.length
            ? `${filteredComments.length} note${filteredComments.length > 1 ? 's' : ''} from clients`
            : 'No notes'
        }}
      </footer>
    </aside>
  </Teleport>
</template>
