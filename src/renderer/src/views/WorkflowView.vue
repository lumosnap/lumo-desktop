<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import { 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Search, 
  ArrowLeft, 
  ChevronDown,
  StickyNote,
  FolderOpen
} from 'lucide-vue-next'
import Button from '../components/ui/Button.vue'
import { useWorkflowStore, type WorkflowImage } from '../stores/workflow'
import { useAlbumStore } from '../stores/album'
import { storeToRefs } from 'pinia'

const router = useRouter()
const workflowStore = useWorkflowStore()
const albumStore = useAlbumStore()

// Destructure state for template usage
const { 
  loading, 
  selectedAlbumId, 
  showDone, 
  searchQuery, 
  displayedImages, 
  hasMore 
} = storeToRefs(workflowStore)

// Fetch albums for the filter dropdown
const { albums } = storeToRefs(albumStore)

function getThumbnailPath(localFilePath: string): string {
  const lastSlash = localFilePath.lastIndexOf('/')
  if (lastSlash === -1) return localFilePath
  const dir = localFilePath.substring(0, lastSlash)
  const filename = localFilePath.substring(lastSlash + 1)
  return `${dir}/.thumbnails/${filename}`
}

async function showOriginalInFolder(image: WorkflowImage) {
  try {
    const result = await window.api.shell.showItemInFolder(image.albumId, image.id)
    if (!result.success) {
      console.error('Failed to show in folder:', result.error)
    }
  } catch (err) {
    console.error('Failed to show in folder:', err)
  }
}

onMounted(async () => {
  // Ensure albums are loaded for the filter
  if (albums.value.length === 0) {
    await albumStore.fetchAlbums()
  }
  
  // Load workflow data
  workflowStore.fetchWorkflowData()
})
</script>

<template>
  <AppLayout>
    <div class="flex h-full flex-col bg-slate-50 text-slate-900">
      <!-- Header -->
      <header class="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4 shadow-sm z-10">
        <div class="flex items-center gap-4">
          <button 
            @click="router.back()"
            class="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft class="h-5 w-5 text-slate-600" />
          </button>
          <div>
            <h1 class="text-2xl font-serif italic text-slate-900 flex items-center gap-2">
              <StickyNote class="h-6 w-6 text-amber-500" />
              Workflow Board
            </h1>
          </div>
        </div>
        
        <div class="flex items-center gap-4">
          <!-- Album Filter -->
          <div class="relative group">
            <select
              v-model="selectedAlbumId"
              class="h-10 appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-4 pr-10 text-sm font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 cursor-pointer min-w-[160px]"
            >
              <option value="all">All Albums</option>
              <option v-for="album in albums" :key="album.id" :value="album.id">
                {{ album.title }}
              </option>
            </select>
            <ChevronDown class="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          <!-- Show Done Toggle -->
          <label class="flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white transition-colors">
            <input type="checkbox" v-model="showDone" class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            <span class="text-sm font-medium text-slate-700">Show Completed</span>
          </label>

          <!-- Search -->
          <div class="relative">
            <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search notes..."
              class="h-10 w-64 rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>
      </header>

      <!-- Content -->
      <main class="flex-1 overflow-y-auto p-8 bg-slate-50/50">
        <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 items-start">
          <div v-for="i in 10" :key="i" class="flex flex-col bg-white rounded-sm shadow-sm border-t-8 border-slate-200 overflow-hidden h-[280px] animate-pulse">
            <!-- Thumbnail Skeleton -->
            <div class="h-40 w-full bg-slate-200"></div>
            
            <!-- Content Skeleton -->
            <div class="p-4 flex-1 flex flex-col gap-3">
              <div class="space-y-2">
                <div class="h-4 w-3/4 bg-slate-200 rounded"></div>
                <div class="h-3 w-1/2 bg-slate-200 rounded"></div>
              </div>
              
              <!-- Notes Skeleton -->
              <div class="flex-1 bg-slate-100 rounded"></div>
              
              <!-- Actions Skeleton -->
              <div class="flex gap-2 pt-2 border-t border-slate-100">
                <div class="h-6 w-6 rounded bg-slate-200"></div>
                <div class="h-6 w-6 rounded bg-slate-200"></div>
                <div class="h-6 w-6 rounded bg-slate-200"></div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="displayedImages.length === 0" class="flex h-full flex-col items-center justify-center text-center opacity-60">
          <div class="bg-white p-6 rounded-full shadow-sm mb-4">
            <StickyNote class="h-12 w-12 text-amber-200" />
          </div>
          <h3 class="text-lg font-medium text-slate-900">No active tasks found</h3>
          <p class="text-sm text-slate-500 max-w-xs mx-auto mt-1">
            Images marked as "Needs Work" or "In Progress" will appear here.
            <span v-if="!showDone">Check "Show Completed" to see finished tasks.</span>
          </p>
        </div>

        <div v-else>
          <!-- Masonry-like Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 items-start">
            <div
              v-for="image in displayedImages"
              :key="image.id"
              class="group relative flex flex-col bg-yellow-50 rounded-sm shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden border-t-8 border-yellow-200/50"
              :class="{
                'bg-amber-50 border-amber-200/50': image.localTodoStatus === 'needs-work',
                'bg-blue-50 border-blue-200/50': image.localTodoStatus === 'working',
                'bg-emerald-50 border-emerald-200/50': image.localTodoStatus === 'done'
              }"
              style="min-height: 280px;"
            >
              <!-- Pin Effect -->
              <div class="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-black/10 shadow-inner z-10"></div>

              <!-- Image Thumbnail (Top) -->
              <div class="h-40 w-full overflow-hidden bg-black/5 relative group-hover:h-48 transition-all duration-300">
                <img
                  :src="`file://${getThumbnailPath(image.localFilePath)}`"
                  class="h-full w-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                  loading="lazy"
                  @error="(e) => (e.target as HTMLImageElement).src = `file://${image.localFilePath}`"
                />
                
                <!-- Status Badge Overlay -->
                <div class="absolute top-2 right-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider shadow-sm backdrop-blur-md bg-white/90"
                  :class="{
                    'text-amber-600': image.localTodoStatus === 'needs-work',
                    'text-blue-600': image.localTodoStatus === 'working',
                    'text-emerald-600': image.localTodoStatus === 'done'
                  }"
                >
                  {{ image.localTodoStatus?.replace('-', ' ') }}
                </div>

                <!-- Open in Folder Button (Hover) -->
                <button
                  @click.stop="showOriginalInFolder(image)"
                  class="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-white/90 text-slate-700 shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-white hover:scale-110"
                  title="Show in Folder"
                >
                  <FolderOpen class="h-4 w-4" />
                </button>
              </div>

              <!-- Content -->
              <div class="p-4 flex-1 flex flex-col">
                <div class="flex items-start justify-between mb-2">
                  <div>
                    <h4 class="font-medium text-slate-800 text-sm truncate w-32" :title="image.originalFilename">{{ image.originalFilename }}</h4>
                    <p class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{{ image.albumTitle }}</p>
                  </div>
                </div>

                <!-- Notes Area (Handwritten style) -->
                <div class="flex-1 relative">
                  <textarea
                    :value="image.localNotes || ''"
                    @change="(e) => workflowStore.updateNotes(image, (e.target as HTMLTextAreaElement).value)"
                    placeholder="Write a note..."
                    class="w-full h-full min-h-[100px] bg-transparent border-none resize-none text-slate-700 placeholder:text-slate-400/70 focus:ring-0 text-sm leading-relaxed font-handwriting"
                    style="font-family: 'Indie Flower', 'Comic Sans MS', cursive, sans-serif;" 
                  ></textarea>
                </div>

                <!-- Actions Footer -->
                <div class="mt-4 pt-3 border-t border-black/5 flex items-center justify-between gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                  <div class="flex gap-1">
                    <button 
                      @click="workflowStore.updateStatus(image, 'needs-work')"
                      class="p-1.5 rounded-md hover:bg-amber-100 text-slate-400 hover:text-amber-600 transition-colors"
                      :class="{ 'bg-amber-100 text-amber-600': image.localTodoStatus === 'needs-work' }"
                      title="Needs Work"
                    >
                      <AlertCircle class="w-4 h-4" />
                    </button>
                    <button 
                      @click="workflowStore.updateStatus(image, 'working')"
                      class="p-1.5 rounded-md hover:bg-blue-100 text-slate-400 hover:text-blue-600 transition-colors"
                      :class="{ 'bg-blue-100 text-blue-600': image.localTodoStatus === 'working' }"
                      title="In Progress"
                    >
                      <Clock class="w-4 h-4" />
                    </button>
                    <button 
                      @click="workflowStore.updateStatus(image, 'done')"
                      class="p-1.5 rounded-md hover:bg-emerald-100 text-slate-400 hover:text-emerald-600 transition-colors"
                      :class="{ 'bg-emerald-100 text-emerald-600': image.localTodoStatus === 'done' }"
                      title="Completed"
                    >
                      <CheckCircle2 class="w-4 h-4" />
                    </button>
                  </div>
                  
                  <button 
                    @click="workflowStore.updateStatus(image, 'normal')"
                    class="text-xs text-slate-400 hover:text-red-500 hover:underline"
                    title="Remove from workflow"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Load More -->
          <div v-if="hasMore" class="mt-8 flex justify-center">
            <Button variant="secondary" @click="workflowStore.loadMore()">Load More Notes</Button>
          </div>
        </div>
      </main>
    </div>
  </AppLayout>
</template>

<style scoped>
/* Add a handwriting font if available, or fallback */
@import url('https://fonts.googleapis.com/css2?family=Indie+Flower&display=swap');

.font-handwriting {
  font-family: 'Indie Flower', cursive;
}
</style>
