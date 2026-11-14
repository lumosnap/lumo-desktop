<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronRight, Folder, Cloud, ArrowUp, Check } from 'lucide-vue-next'
import Modal from './ui/Modal.vue'
import { useNetworkStore } from '../stores/network'
import { toast } from '../composables/useToast'

const networkStore = useNetworkStore()

interface SyncChanges {
  new: Array<{ filename: string; size: number }>
  modified: Array<{ filename: string; existingId: number }>
  deleted: Array<{ id: number; serverId: number | null; originalFilename: string }>
  renamed: Array<{ oldFilename: string; newFilename: string }>
  skipped: Array<{ filename: string; reason: string }>
}

interface Props {
  show: boolean
  albumId: string
  albumTitle: string
  folder?: string
  changes: SyncChanges | null
  isLoading?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  sync: []
  /** The folder went away (drive unplugged): nothing was synced */
  missing: []
}>()

// list -> (confirm, when most photos would leave) -> syncing -> done
const phase = ref<'list' | 'confirm' | 'syncing' | 'done'>('list')
const syncError = ref('')
const massDelete = ref({ count: 0, total: 0 })

const totalChanges = computed(() => {
  if (!props.changes) return 0
  return (
    props.changes.new.length +
    props.changes.modified.length +
    props.changes.deleted.length +
    props.changes.renamed.length
  )
})
const hasChanges = computed(() => totalChanges.value > 0)
const skipped = computed(() => props.changes?.skipped || [])

const title = computed(() =>
  phase.value === 'syncing'
    ? 'Syncing'
    : phase.value === 'done'
      ? 'In sync'
      : phase.value === 'confirm'
        ? `Remove ${massDelete.value.count} photos?`
        : 'Review folder changes'
)

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

async function handleSync(confirmMassDelete = false): Promise<void> {
  if (!props.changes) return

  phase.value = 'syncing'
  syncError.value = ''
  const title = props.albumTitle
  const started = props.changes
  // The dialog may have been closed, or reopened on another album, while this ran
  const stillHere = (): boolean => props.show && props.changes === started

  try {
    // Deep clone to strip Vue reactivity - IPC can't clone reactive objects
    const plainChanges = JSON.parse(JSON.stringify(props.changes))
    const result = await window.api.sync.execute(props.albumId, plainChanges, confirmMassDelete)
    if (result.error === 'FOLDER_MISSING') {
      phase.value = 'list'
      if (stillHere()) emit('missing')
      toast(`The folder for “${title}” is not available, so nothing was synced.`)
      return
    }
    if (result.error === 'CONFIRM_MASS_DELETE') {
      massDelete.value = { count: result.count ?? 0, total: result.total ?? 0 }
      // Closed meanwhile: don't leave a confirm step armed for the next album opened here
      phase.value = stillHere() ? 'confirm' : 'list'
      if (!stillHere()) toast(`Nothing synced for “${title}”: it would remove most of its photos.`)
      return
    }
    if (!result.success) throw new Error(result.error || 'Sync failed')
    if (result.limitWarning) {
      // Keep the dialog on the list so the warning is read; don't report a clean sync
      phase.value = 'list'
      if (stillHere()) syncError.value = result.limitWarning
      else toast(result.limitWarning)
      return
    }
    emit('sync')
    if (stillHere()) phase.value = 'done'
    else {
      phase.value = 'list'
      toast(`“${title}” is in sync`)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    console.error('[SyncModal] Sync error:', error)
    phase.value = 'list'
    if (stillHere()) syncError.value = message
    else toast(`Sync failed for “${title}”: ${message}`)
  }
}

// Reset state when the dialog closes or is reused for another album (a running sync keeps
// going: "Run in background"). A confirm step must never carry over to other changes.
watch(
  () => [props.show, props.albumId, props.changes] as const,
  ([show], [wasShown]) => {
    if (phase.value === 'syncing') return
    if (!show || !wasShown || phase.value === 'confirm') {
      phase.value = 'list'
      syncError.value = ''
    }
  }
)
</script>

<template>
  <Modal :show="show" :title="title" :sub="albumTitle" wide @close="emit('close')">
    <div v-if="isLoading" class="wait" style="margin: 24px 0">
      <span class="spin"></span>Comparing the folder with the album…
    </div>

    <template v-else-if="phase === 'confirm'">
      <p>
        This would remove {{ massDelete.count }} of {{ massDelete.total }} photos from the online
        gallery. Usually this means the folder was moved or the drive isn't fully connected.
      </p>
    </template>

    <div v-else-if="phase !== 'list'" class="flight">
      <div class="ends">
        <span><Folder style="width: 16px" /> Folder</span>
        <div
          class="track"
          role="progressbar"
          :aria-valuenow="phase === 'done' ? totalChanges : 0"
          :aria-valuemax="totalChanges"
        >
          <span class="fill" :style="{ transform: `scaleX(${phase === 'done' ? 1 : 0})` }"></span>
          <span class="rail" :style="{ transform: `translateX(${phase === 'done' ? 100 : 0}%)` }">
            <span class="plane"><Check v-if="phase === 'done'" /><ArrowUp v-else /></span>
          </span>
        </div>
        <span>Cloud <Cloud style="width: 16px" /></span>
      </div>
      <div class="box">
        <div>
          <b class="mono" style="overflow-wrap: anywhere">{{ folder || albumTitle }}</b>
          <small>{{ albumTitle }}</small>
        </div>
        <div class="r">
          <b class="num">{{
            phase === 'done' ? `${totalChanges} of ${totalChanges}` : `${totalChanges} changes`
          }}</b>
          <small>{{ phase === 'done' ? 'Done just now' : 'Applying…' }}</small>
        </div>
      </div>
    </div>

    <div
      v-else-if="!hasChanges && !skipped.length"
      class="empty"
      style="padding: 32px 0; margin: 0"
    >
      <h2>Album is in sync</h2>
      <p>No changes in the folder since the last upload.</p>
    </div>

    <template v-else>
      <p v-if="hasChanges">
        The folder changed since the last upload. Nothing changes in the album until you sync.
      </p>
      <p v-else>Every change in the folder was skipped, so there is nothing to sync.</p>
      <div class="changes">
        <details v-if="changes?.new.length" open>
          <summary>
            <ChevronRight /><span class="dot brand"></span>New photos
            <span class="n num">{{ changes.new.length }}</span>
          </summary>
          <ul>
            <li v-for="f in changes.new" :key="f.filename">
              {{ f.filename }} <small>{{ formatBytes(f.size) }}</small>
            </li>
          </ul>
        </details>
        <details v-if="changes?.modified.length">
          <summary>
            <ChevronRight /><span class="dot"></span>Edited
            <span class="n num">{{ changes.modified.length }}</span>
          </summary>
          <ul>
            <li v-for="f in changes.modified" :key="f.existingId">{{ f.filename }}</li>
          </ul>
        </details>
        <details v-if="changes?.renamed.length">
          <summary>
            <ChevronRight /><span class="dot"></span>Renamed
            <span class="n num">{{ changes.renamed.length }}</span>
          </summary>
          <ul>
            <li v-for="f in changes.renamed" :key="f.oldFilename">
              {{ f.oldFilename }} → {{ f.newFilename }}
            </li>
          </ul>
        </details>
        <details v-if="changes?.deleted.length" open>
          <summary>
            <ChevronRight /><span class="dot bad"></span>Removed from folder
            <span class="n num">{{ changes.deleted.length }}</span>
          </summary>
          <ul>
            <li v-for="f in changes.deleted" :key="f.id">
              {{ f.originalFilename }} <small>leaves the album</small>
            </li>
          </ul>
        </details>
        <details v-if="skipped.length">
          <summary>
            <ChevronRight /><span class="dot"></span>Skipped
            <span class="n num">{{ skipped.length }}</span>
          </summary>
          <ul>
            <li v-for="f in skipped" :key="f.filename">
              {{ f.filename }} <small>{{ f.reason }}</small>
            </li>
          </ul>
        </details>
      </div>
      <p v-if="syncError" class="err"><span class="dot bad"></span>{{ syncError }}</p>
    </template>

    <template #footer>
      <button v-if="phase === 'syncing'" class="btn ghost" @click="emit('close')">
        Run in background
      </button>
      <button v-else-if="phase === 'done'" class="btn primary" autofocus @click="emit('close')">
        Done
      </button>
      <template v-else-if="phase === 'confirm'">
        <button class="btn ghost" autofocus @click="emit('close')">Cancel</button>
        <button
          class="btn danger"
          :disabled="!networkStore.isOnline"
          :title="!networkStore.isOnline ? 'Removing photos needs a connection' : ''"
          @click="handleSync(true)"
        >
          Delete {{ massDelete.count }} photos
        </button>
      </template>
      <template v-else-if="!isLoading && hasChanges">
        <button class="btn ghost" @click="emit('close')">Cancel</button>
        <button
          class="btn primary"
          :disabled="!networkStore.isOnline"
          :title="!networkStore.isOnline ? 'Syncing needs a connection' : ''"
          @click="handleSync()"
        >
          {{
            networkStore.isOnline
              ? `Sync ${totalChanges} change${totalChanges === 1 ? '' : 's'}`
              : 'Offline'
          }}
        </button>
      </template>
      <button v-else class="btn ghost" @click="emit('close')">
        {{ isLoading ? 'Cancel' : 'Close' }}
      </button>
    </template>
  </Modal>
</template>
