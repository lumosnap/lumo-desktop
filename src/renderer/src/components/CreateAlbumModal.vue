<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Modal from './ui/Modal.vue'
import { FolderOpen, Folder, X } from 'lucide-vue-next'
import { useProfileStore } from '../stores/profile'
import { useNetworkStore } from '../stores/network'
import { EVENT_TYPES } from '../utils/tags'

const profileStore = useProfileStore()
const networkStore = useNetworkStore()

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
  /** note: what to tell the person instead of "Made …" (re-attached or relinked) */
  created: [album: { id: string; title: string; sourceFolderPath: string; note?: string }]
}>()

const title = ref<string>('')
const eventType = ref('wedding') // picks the tags AI suggests; changeable later in Album tags
const isCreating = ref(false)
const error = ref<string | null>(null)

// Source folder path - required
const sourceFolderPath = ref<string>('')

// The folder already belongs to an album: a copy of one here, or one whose folder went missing
const found = ref<{ kind: 'COPY' | 'RELINK'; albumId: string; title: string } | null>(null)
watch(sourceFolderPath, () => (found.value = null))

// Reset form when the modal closes
watch(
  () => props.show,
  (newValue) => {
    if (!newValue) {
      resetForm()
    }
  }
)

const limitWarning = computed(() => {
  if (!profileStore.profile) return null
  if (profileStore.isAtLimit) {
    return {
      type: 'bad' as const,
      message:
        "You've reached your photo limit. New photos won't upload until you upgrade your plan."
    }
  }
  if (profileStore.isNearLimit) {
    return {
      type: 'warn' as const,
      message: `Only ${profileStore.remainingImages.toLocaleString('en-IN')} photos left in your plan.`
    }
  }
  return null
})

const isFormValid = computed(() => {
  return title.value.trim().length > 0 && sourceFolderPath.value.trim().length > 0
})

async function selectFolder(): Promise<void> {
  try {
    const result = await window.api.dialog.openDirectory()
    if (result) {
      sourceFolderPath.value = result
      // Auto-fill title from folder name if empty
      if (!title.value.trim()) {
        title.value = result.split(/[/\\]/).pop() || ''
      }
    }
  } catch (err) {
    console.error('Failed to open folder dialog:', err)
    error.value = "Couldn't open the folder picker"
  }
}

function clearFolder(): void {
  sourceFolderPath.value = ''
}

async function createAlbum(): Promise<void> {
  if (!isFormValid.value) {
    error.value = 'Give the album a name and choose a folder'
    return
  }
  if (found.value?.kind === 'RELINK') return useForFoundAlbum()

  isCreating.value = true
  error.value = null

  try {
    const result = await window.api.albums.create({
      title: title.value.trim(),
      eventDate: null,
      sourceFolderPath: sourceFolderPath.value,
      albumType: 'standalone',
      eventType: eventType.value,
      asNewAlbum: found.value?.kind === 'COPY'
    })

    if (result.success) {
      const a = result.adopted
      emit('created', {
        id: result.album.id,
        title: a ? a.title : title.value.trim(),
        sourceFolderPath: sourceFolderPath.value,
        note: a
          ? a.remote
            ? `“${a.title}” is ready. ${a.remote.toLocaleString('en-IN')} photo${a.remote === 1 ? ' is' : 's are'} only online.`
            : `“${a.title}” is ready, with its photos from your other computer.`
          : undefined
      })
      resetForm()
    } else if ((result.error === 'COPY' || result.error === 'RELINK') && result.albumId) {
      found.value = { kind: result.error, albumId: result.albumId, title: result.title ?? '' }
    } else {
      error.value = result.error || 'Failed to create album'
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to create album'
  } finally {
    isCreating.value = false
  }
}

// The folder is this computer's album whose folder went missing: point that album at it
async function useForFoundAlbum(): Promise<void> {
  const f = found.value
  if (!f) return
  isCreating.value = true
  error.value = null
  try {
    const res = await window.api.albums.relink(f.albumId, sourceFolderPath.value)
    if (!res.success) {
      error.value =
        res.error === 'CONFIRM_MISSING'
          ? `Most of “${f.title}”’s photos aren’t in this folder. Use Choose folder on the album to check it.`
          : res.error === 'BUSY'
            ? `“${f.title}” is uploading. Try again when it finishes.`
            : res.error || 'Could not use this folder'
      return
    }
    emit('created', {
      id: f.albumId,
      title: f.title,
      sourceFolderPath: sourceFolderPath.value,
      note: `“${f.title}” uses this folder now.`
    })
    resetForm()
  } finally {
    isCreating.value = false
  }
}

function resetForm(): void {
  found.value = null
  title.value = ''
  eventType.value = 'wedding'
  error.value = null
  sourceFolderPath.value = ''
}

function handleClose(): void {
  if (!isCreating.value) {
    resetForm()
    emit('close')
  }
}
</script>

<template>
  <Modal :show="show" title="New album" @close="handleClose">
    <form id="create-album" style="display: grid; gap: 16px" @submit.prevent="createAlbum">
      <div
        v-if="limitWarning"
        class="inset"
        style="display: flex; gap: 8px; align-items: center; font-size: 13px"
      >
        <span class="dot" :class="limitWarning.type"></span>
        <span style="flex: 1">{{ limitWarning.message }}</span>
        <router-link class="btn sm ghost" to="/settings/billing" @click="handleClose"
          >See plans</router-link
        >
      </div>

      <div class="field">
        <label for="a-name">Album name</label>
        <input
          id="a-name"
          v-model="title"
          class="input"
          required
          placeholder="Anjali &amp; Rahul"
          :disabled="isCreating"
          autofocus
        />
      </div>

      <div class="field">
        <label for="a-event">What kind of event?</label>
        <select id="a-event" v-model="eventType" class="input" :disabled="isCreating">
          <option v-for="e in EVENT_TYPES" :key="e.id" :value="e.id">{{ e.label }}</option>
        </select>
      </div>

      <div class="field">
        <span class="lbl">Photos from</span>
        <div v-if="sourceFolderPath" class="inset path-row" style="padding: 8px 8px 8px 16px">
          <Folder />
          <span class="p" :title="sourceFolderPath">{{ sourceFolderPath }}</span>
          <button
            type="button"
            class="icon-btn sm plain"
            aria-label="Choose a different folder"
            :disabled="isCreating"
            @click="clearFolder"
          >
            <X />
          </button>
        </div>
        <button
          v-else
          type="button"
          class="btn ghost"
          style="justify-content: flex-start"
          :disabled="isCreating"
          @click="selectFolder"
        >
          <FolderOpen />Choose a folder you already have…
        </button>
        <span class="hint">{{
          sourceFolderPath
            ? 'Photos stay in this folder. New ones you add here upload on their own.'
            : 'Pick the folder on this computer that holds the shoot. LumoSnap uploads what is in it.'
        }}</span>
      </div>

      <p v-if="found?.kind === 'COPY'">
        This folder looks like a copy of “{{ found.title }}”. Create a separate album for it?
      </p>
      <p v-else-if="found?.kind === 'RELINK'">
        This folder belongs to “{{ found.title }}”, whose folder is missing on this computer. Use it
        for “{{ found.title }}” instead?
      </p>
      <p v-if="error" class="err"><span class="dot bad"></span>{{ error }}</p>
    </form>

    <template #footer>
      <button class="btn ghost" :disabled="isCreating" @click="handleClose">Cancel</button>
      <button
        type="submit"
        form="create-album"
        class="btn primary"
        :disabled="!isFormValid || isCreating || !networkStore.isOnline"
        :title="!networkStore.isOnline ? 'New albums need a connection' : ''"
      >
        <template v-if="!networkStore.isOnline">Offline</template>
        <template v-else-if="isCreating"><span class="spin"></span>Creating…</template>
        <template v-else-if="found?.kind === 'COPY'">Create separate album</template>
        <template v-else-if="found?.kind === 'RELINK'">Use for “{{ found.title }}”</template>
        <template v-else>Create album</template>
      </button>
    </template>
  </Modal>
</template>
