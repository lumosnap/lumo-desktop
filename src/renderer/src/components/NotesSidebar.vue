<script setup lang="ts">
import { computed } from 'vue'
import { X, MessageSquare, User } from 'lucide-vue-next'

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

// Filter comments to only show those with notes
const filteredComments = computed(() => {
  if (!props.image?.comments) return []
  return props.image.comments.filter((c) => c.notes && c.notes.trim().length > 0)
})

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[1100000] bg-black/40 backdrop-blur-sm"
        @click="emit('close')"
      />
    </Transition>

    <!-- Sidebar -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <div
        v-if="isOpen"
        class="fixed right-0 top-0 z-[1100001] h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
      >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-slate-200 p-4">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white"
            >
              <MessageSquare class="h-5 w-5" />
            </div>
            <div>
              <h2 class="text-lg font-bold text-slate-900">Client Notes</h2>
              <p class="text-sm text-slate-500 truncate max-w-[200px]">
                {{ image?.originalFilename }}
              </p>
            </div>
          </div>
          <button
            class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            @click="emit('close')"
          >
            <X class="h-5 w-5" />
          </button>
        </div>

        <!-- Comments List -->
        <div class="flex-1 overflow-y-auto p-4">
          <!-- Empty State -->
          <div
            v-if="filteredComments.length === 0"
            class="flex h-full flex-col items-center justify-center text-center"
          >
            <div
              class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-3xl"
            >
              💭
            </div>
            <h3 class="mb-2 text-lg font-semibold text-slate-900">No Notes Yet</h3>
            <p class="max-w-[200px] text-sm text-slate-500">
              Clients haven't left any notes on this photo yet.
            </p>
          </div>

          <!-- Comments -->
          <div v-else class="space-y-4">
            <div
              v-for="(comment, index) in filteredComments"
              :key="index"
              class="rounded-2xl border border-slate-100 bg-slate-50 p-4"
            >
              <!-- Client Info -->
              <div class="mb-3 flex items-center gap-3">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-sm font-bold text-white"
                >
                  <User class="h-4 w-4" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-slate-700">
                    {{ comment.clientName }}
                  </p>
                  <p class="text-xs text-slate-400">
                    {{ formatDate(comment.createdAt) }}
                  </p>
                </div>
              </div>

              <!-- Note Content -->
              <p class="text-base text-slate-800 leading-relaxed">
                {{ comment.notes }}
              </p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="border-t border-slate-200 bg-slate-50 p-4">
          <p class="text-center text-xs text-slate-400">
            {{ filteredComments.length }} note{{ filteredComments.length !== 1 ? 's' : '' }} from
            clients
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
