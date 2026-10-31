<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { CircleCheck, X, Link } from 'lucide-vue-next'
import type { Album } from '../stores/album'
import type { UploadProgress } from '../../../main/pipeline'

// Header pill + popover for the running upload (mock: pillHtml / upPop).
const props = defineProps<{
  progress: UploadProgress | null
  album?: Album
  done: boolean
  failed: number
  offline: boolean
}>()
const emit = defineEmits<{ dismiss: []; share: []; showFailed: [] }>()

const open = ref(false)
const pos = ref({ top: 92, right: 24 })
const pill = ref<HTMLButtonElement>()

const nf = (n: number): string => n.toLocaleString('en-IN')
const total = computed(() => props.progress?.total || 0)
const sent = computed(() => props.progress?.complete || 0)
const uploading = computed(() => props.progress?.uploading || 0)
// pipeline keeps "compressing" until a file starts uploading, so pending covers both
const compressing = computed(
  () => (props.progress?.compressing || 0) + (props.progress?.pending || 0)
)
const pSent = computed(() => (total.value ? sent.value / total.value : 0))
const pPast = computed(() => (total.value ? (sent.value + uploading.value) / total.value : 0))
const pct = computed(() => Math.round(pSent.value * 100))
const thumb = computed(() => (props.album?.thumbnail ? `file://${props.album.thumbnail}` : ''))

function toggle(): void {
  open.value = !open.value
  const r = pill.value?.getBoundingClientRect()
  if (r) pos.value = { top: r.bottom + 8, right: innerWidth - r.right }
}

function later(): void {
  open.value = false
  emit('dismiss')
}

function share(): void {
  open.value = false
  emit('share')
}

function showFailed(): void {
  open.value = false
  emit('showFailed')
}

function onDown(e: PointerEvent): void {
  if (open.value && !(e.target as HTMLElement).closest?.('.up-pop, .up-pill')) open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onDown)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDown)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <button ref="pill" class="up-pill" :aria-expanded="open" @click="toggle">
    <template v-if="done">
      <CircleCheck style="color: var(--ok)" /><span class="lbl">Ready to share</span>
    </template>
    <template v-else>
      <span class="bar" aria-hidden="true">
        <span :style="{ '--p': pSent }"></span>
        <span class="pending" :style="{ '--p': pPast }"></span>
      </span>
      <span class="lbl num">{{
        offline ? 'Paused, offline' : `Uploading ${nf(sent)} of ${nf(total)}`
      }}</span>
    </template>
  </button>

  <Teleport to="body">
    <div
      v-if="open && done"
      class="up-pop"
      role="dialog"
      aria-label="Upload finished"
      :style="{ top: pos.top + 'px', right: pos.right + 'px' }"
    >
      <div class="who-line">
        <img v-if="thumb" class="thumb" :src="thumb" alt="" />
        <div>
          <div>{{ album?.title }}</div>
          <div class="sub" style="color: var(--ink-3); font-size: 13px">Uploaded just now</div>
        </div>
        <button
          class="icon-btn sm plain"
          style="margin-left: auto"
          aria-label="Close"
          @click="open = false"
        >
          <X />
        </button>
      </div>
      <div class="meter">
        <div class="meter-top">
          <span class="big num" style="color: var(--ok)"
            >{{ nf(album?.totalImages || 0) }} photos online</span
          >
        </div>
        <div class="bar lg"><span style="--p: 1; background: var(--ok)"></span></div>
      </div>
      <p style="margin: 16px 0 0; color: var(--ink-2); font-size: 14px">
        {{ failed ? `${failed} files were skipped. ` : '' }}Your client can start picking as soon as
        they have the link.
      </p>
      <div style="display: flex; gap: 8px; margin-top: 16px">
        <button class="btn ghost" style="flex: 1" @click="later">Later</button>
        <button class="btn primary" style="flex: 1" @click="share">
          <Link />Share with client
        </button>
      </div>
    </div>

    <div
      v-else-if="open"
      class="up-pop"
      role="dialog"
      aria-label="Upload progress"
      :style="{ top: pos.top + 'px', right: pos.right + 'px' }"
    >
      <div class="who-line">
        <img v-if="thumb" class="thumb" :src="thumb" alt="" />
        <div>
          <div>{{ album?.title || 'Upload' }}</div>
          <div class="sub" style="color: var(--ink-3); font-size: 13px">
            {{ offline ? 'Paused until you reconnect' : 'Uploading' }}
          </div>
        </div>
        <button
          class="icon-btn sm plain"
          style="margin-left: auto"
          aria-label="Close"
          @click="open = false"
        >
          <X />
        </button>
      </div>
      <div class="meter">
        <div class="meter-top">
          <span class="big num">{{ pct }}%</span>
          <span class="cap num">{{ nf(sent) }} of {{ nf(total) }} sent</span>
        </div>
        <!-- ponytail: no per-file positions from the pipeline, so no red failure notches -->
        <div class="bar lg" aria-hidden="true">
          <span :style="{ '--p': pSent }"></span>
          <span class="pending" :style="{ '--p': pPast }"></span>
        </div>
      </div>
      <div class="stages">
        <div>
          <b class="num">{{ nf(sent) }}</b
          ><small>Sent</small>
        </div>
        <div>
          <b class="num">{{ nf(uploading) }}</b
          ><small>Uploading</small>
        </div>
        <div>
          <b class="num">{{ nf(compressing) }}</b
          ><small>Compressing</small>
        </div>
        <div :class="{ bad: failed }">
          <b class="num">{{ failed }}</b
          ><small>Failed</small>
        </div>
      </div>
      <div
        v-if="failed"
        class="inset"
        style="margin-top: 16px; display: flex; align-items: center; gap: 8px; font-size: 13px"
      >
        <span class="dot bad"></span>
        <span style="flex: 1">{{ failed }} files couldn't be read and were skipped</span>
        <button class="btn sm ghost" @click="showFailed">Show files</button>
      </div>
    </div>
  </Teleport>
</template>
