<script setup lang="ts">
import { ref, watch } from 'vue'
import { Copy, Check, ExternalLink, RotateCw } from 'lucide-vue-next'
import Modal from './ui/Modal.vue'

// Mock: shareDlg. Same localStorage cache as the gallery's share button.
const props = defineProps<{ show: boolean; albumId: string; albumTitle: string }>()
const emit = defineEmits<{ close: [] }>()

const url = ref('')
const loading = ref(false)
const error = ref('')
const copied = ref(false)
const copiedOnce = ref(false)

async function load(): Promise<void> {
  const key = `shareLink_album_${props.albumId}`
  error.value = ''
  url.value = localStorage.getItem(key) || ''
  if (url.value) return
  loading.value = true
  try {
    const result = await window.api.api.generateShareLink(props.albumId)
    if (!result.success || !result.shareLink)
      throw new Error(result.error || 'Could not make a link')
    url.value = result.shareLink.shareUrl
    localStorage.setItem(key, url.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not make a link'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (show) => {
    copied.value = copiedOnce.value = false
    if (show) load()
  }
)

// main's setWindowOpenHandler sends this to the default browser
function openInBrowser(): void {
  window.open(url.value, '_blank')
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(url.value)
    copied.value = copiedOnce.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    error.value = "Couldn't copy. Select the link and copy it by hand."
  }
}
</script>

<template>
  <Modal :show="show" title="Client link" :sub="albumTitle" @close="emit('close')">
    <p>
      Send this to your client. They can view the photos, heart their picks and leave notes. No
      account needed.
    </p>
    <div v-if="loading" class="wait"><span class="spin"></span>Making the link…</div>
    <div v-else-if="url" class="input-row">
      <input class="input mono" readonly :value="url" aria-label="Client link" />
      <button class="btn primary" @click="copy">
        <template v-if="copied"><Check />Copied</template>
        <template v-else><Copy />Copy</template>
      </button>
    </div>
    <p v-if="copiedOnce" style="font-size: 14px" role="status">
      <Check style="width: 16px; height: 16px; color: var(--ok); vertical-align: -3px" />
      Copied. Paste it in WhatsApp or email. Their hearts and notes appear in this album as they
      pick.
    </p>
    <div v-if="error" class="err">
      <span class="dot bad"></span>{{ error }}
      <button v-if="!url" class="btn sm ghost" @click="load"><RotateCw />Try again</button>
    </div>
    <template #footer>
      <button class="btn ghost" :disabled="!url" @click="openInBrowser">
        <ExternalLink />Open in browser
      </button>
      <button class="btn primary" @click="emit('close')">Done</button>
    </template>
  </Modal>
</template>
