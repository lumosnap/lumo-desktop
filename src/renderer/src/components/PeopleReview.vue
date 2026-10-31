<script setup lang="ts">
// "Is this Anjali?": faces the app is not sure about. Tap the ones that are her; the rest are a no.
// Picking yeses (not rejecting noes) is safer: most of these are not her, and an unread Save
// can't turn strangers into reference faces.
import { ref, computed, onMounted, nextTick } from 'vue'
import { Check, X } from 'lucide-vue-next'
import { toast } from '../composables/useToast'
import {
  decisions,
  faceCrop,
  gridMove,
  type PeopleApi,
  type Person,
  type ReviewFace
} from '../utils/people'

const props = defineProps<{
  albumId: string
  api: PeopleApi
  person: Person
  aspect: (imageId: number) => number
  faceStyle: (p: Person) => Record<string, string> | undefined
}>()
const emit = defineEmits<{ close: []; changed: [] }>()

const BATCH = 24
const dlg = ref<HTMLDialogElement>()
const grid = ref<HTMLElement>()
const faces = ref<ReviewFace[] | null>(null) // null while loading
const loadFailed = ref(false)
const yes = ref(new Set<number>())
const remaining = ref(props.person.reviewCount)
const busy = ref(false)
const first = computed(() => props.person.name.split(' ')[0])
const saveLabel = computed(() => {
  const n = yes.value.size
  return n ? `Save ${n} as ${first.value}` : `None of these are ${first.value}`
})
const later = computed(() => Math.max(0, remaining.value - (faces.value?.length ?? 0)))

async function load(): Promise<void> {
  faces.value = null
  loadFailed.value = false
  yes.value = new Set()
  try {
    faces.value = await props.api.reviewQueue(props.albumId, props.person.id, BATCH)
  } catch {
    // Said in the dialog, with Try again; the answers already saved are kept
    loadFailed.value = true
    await nextTick()
    dlg.value?.querySelector<HTMLElement>('.pr-err .btn')?.focus()
    return
  }
  if (!faces.value.length) return finish()
  await nextTick()
  grid.value?.querySelector<HTMLElement>('button')?.focus()
}

onMounted(() => {
  dlg.value?.showModal()
  load()
})

function finish(): void {
  toast(`${first.value}'s faces are all checked`)
  emit('close')
}

function set(id: number, isYes: boolean): void {
  if (busy.value) return // the answers being saved stay as they were sent
  const next = new Set(yes.value)
  if (isYes) next.add(id)
  else next.delete(id)
  yes.value = next
}

async function confirm(): Promise<void> {
  if (!faces.value?.length || busy.value) return
  busy.value = true
  try {
    const r = await props.api.review(
      props.albumId,
      props.person.id,
      decisions(faces.value, yes.value)
    )
    if (!r.success) throw new Error(r.error)
    emit('changed')
    remaining.value = r.remaining
    if (r.remaining > 0) await load()
    else finish()
  } catch (err) {
    // The answers stay as they are; Save, or Try again, sends them again
    toast(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`, {
      label: 'Try again',
      run: confirm
    })
  } finally {
    busy.value = false
  }
}

// Y and N answer and go to the next face; arrows move; Space or a click flips one
function onKey(e: KeyboardEvent, i: number): void {
  const list = faces.value
  if (!list) return
  const btns = [...(grid.value?.querySelectorAll<HTMLElement>('button') ?? [])]
  const cols = btns.filter((b) => b.offsetTop === btns[0].offsetTop).length || 1
  let to = i
  const k = e.key.toLowerCase()
  if (k === 'y' || k === 'n') {
    set(list[i].faceId, k === 'y')
    to = Math.min(i + 1, list.length - 1)
    if (i === list.length - 1) {
      dlg.value?.querySelector<HTMLElement>('.pr-save')?.focus()
      e.preventDefault()
      return
    }
  } else if (e.key.startsWith('Arrow')) to = gridMove(i, e.key, cols, list.length)
  else return
  e.preventDefault()
  btns[to]?.focus()
}

function crop(f: ReviewFace): Record<string, string> {
  return {
    backgroundImage: `url(${JSON.stringify(`file://${f.path}`)})`,
    ...faceCrop(f.box, props.aspect(f.imageId), 1.6)
  }
}
</script>

<template>
  <dialog
    ref="dlg"
    class="pr"
    aria-labelledby="pr-title"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
  >
    <div class="pr-h">
      <span class="avatar face" :style="faceStyle(person)"></span>
      <div>
        <h2 id="pr-title">Is this {{ first }}?</h2>
        <small>Click the faces that are {{ first }}. The rest won't be suggested again.</small>
      </div>
      <button class="icon-btn sm plain" aria-label="Close" @click="emit('close')"><X /></button>
    </div>

    <div class="pr-b">
      <div v-if="loadFailed" class="pr-err" role="alert">
        <p>Couldn't load {{ first }}'s faces.</p>
        <button class="btn ghost" @click="load">Try again</button>
      </div>
      <div v-else-if="!faces" class="pr-grid" aria-busy="true">
        <div v-for="i in 12" :key="i" class="pr-face skel"></div>
      </div>
      <div
        v-else
        ref="grid"
        class="pr-grid"
        role="group"
        :aria-label="`Is this ${first}?`"
        :aria-busy="busy"
      >
        <button
          v-for="(f, i) in faces"
          :key="f.faceId"
          class="pr-face"
          :aria-pressed="yes.has(f.faceId)"
          :aria-label="first"
          :tabindex="i === 0 ? 0 : -1"
          @click="set(f.faceId, !yes.has(f.faceId))"
          @keydown="onKey($event, i)"
        >
          <span class="crop" :style="crop(f)"></span>
          <span v-if="yes.has(f.faceId)" class="pr-yes"><Check />{{ first }}</span>
        </button>
      </div>
    </div>

    <div class="pr-f">
      <span class="num" aria-live="polite">
        <template v-if="faces">
          {{ yes.size }} of {{ faces.length }} picked
          <template v-if="later"> · {{ later }} more after these</template>
        </template>
      </span>
      <template v-if="!loadFailed">
        <span class="keys" aria-hidden="true"><kbd>Y</kbd> is {{ first }} <kbd>N</kbd> isn't</span>
        <button
          :class="['btn', 'pr-save', yes.size ? 'primary' : 'ghost']"
          :disabled="busy || !faces?.length"
          :aria-busy="busy"
          @click="confirm"
        >
          <span v-if="busy" class="spin"></span>{{ saveLabel }}
        </button>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.pr {
  width: min(880px, calc(100vw - 64px));
  max-width: none;
  max-height: calc(100vh - 64px);
  display: none;
  flex-direction: column;
}
.pr[open] {
  display: flex;
}
.pr-h {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 16px 16px 24px;
}
.pr-h .avatar {
  width: 48px;
  height: 48px;
}
.pr-h h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 400;
  letter-spacing: -0.01em;
}
.pr-h small {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: var(--ink-3);
}
.pr-h .icon-btn {
  margin: 0 0 auto auto;
}
.pr-b {
  overflow: auto;
  padding: 4px 24px 8px;
}
.pr-err {
  padding: 40px 0 32px;
  text-align: center;
  color: var(--ink-2);
  font-size: 14px;
}
.pr-err p {
  margin: 0 0 16px;
}
.pr-grid[aria-busy='true'] .pr-face {
  cursor: progress;
}
/* The answers being sent dim, only once the save is slow enough to notice */
.pr-grid[aria-busy='true'] {
  opacity: 0.6;
  transition: opacity 0.2s 0.3s;
}
.pr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 10px;
}
/* A face crop, square, the size of a contact-sheet frame */
.pr-face {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: var(--r-inset);
  overflow: hidden;
  background: var(--inset-2);
}
.pr-face .crop {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  transition:
    opacity 0.12s var(--ease),
    filter 0.12s var(--ease);
}
.pr-face[aria-pressed='true']::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 3px var(--brand);
  pointer-events: none;
}
.pr-face:hover .crop {
  filter: brightness(1.06);
}
.pr-face:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
}
.pr-face .pr-yes {
  position: absolute;
  inset: auto 6px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  border-radius: 99px;
  background: var(--brand);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
}
.pr-face .pr-yes svg {
  width: 14px;
  height: 14px;
}
.pr-f {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 24px 20px;
}
.pr-f > .num {
  margin-right: auto;
  font-size: 13px;
  color: var(--ink-3);
}
.keys {
  margin-right: 8px;
  font-size: 12px;
  color: var(--ink-3);
}
kbd {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  margin: 0 2px 0 6px;
  border-radius: 6px;
  background: var(--inset-2);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
}
</style>
