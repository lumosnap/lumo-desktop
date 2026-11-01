<script setup lang="ts">
// Pick people from a photo: choose a group photo, click a face, type a name, Enter, next face.
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { Check, Plus, X } from 'lucide-vue-next'
import { toast } from '../composables/useToast'
import {
  byPosition,
  matchPeople,
  nextToName,
  pickEmptyText,
  type Face,
  type FaceTarget,
  type PeopleApi,
  type PeopleConfig,
  type Person,
  type PickPhoto
} from '../utils/people'

const props = defineProps<{
  albumId: string
  api: PeopleApi
  people: Person[]
  /** Large source and width / height of a photo; null when the album no longer has it */
  photo: (imageId: number) => { src: string; aspect: number } | null
  faceStyle: (p: Person) => Record<string, string> | undefined
  /** The photo last open in the lightbox, offered first when it has faces */
  lastViewedId?: number | null
  /** Face finding progress: says why there is nothing to pick yet */
  scan?: PeopleConfig | null
}>()
const emit = defineEmits<{ close: []; changed: [] }>()

const dlg = ref<HTMLDialogElement>()
const nameIn = ref<HTMLInputElement>()
const doneBtn = ref<HTMLButtonElement>()
const picks = ref<PickPhoto[] | null>(null) // null while loading
const picksFailed = ref(false)
const lastViewed = ref<PickPhoto | null>(null)
const chosen = ref<PickPhoto | null>(null)
const faces = ref<Face[] | null>([]) // null while the chosen photo's faces load
const at = ref(-1) // the face being named
const query = ref('')
// The highlighted option by key, so a reload or re-sort of people keeps it on the same person;
// null: Enter skips the face
const hiKey = ref<string | null>(null)
const busy = ref(false)
// Where the spinner goes while a name saves: the option that was taken, or "Not Anjali"
const savingAt = ref<string | 'not' | null>(null)

const facesWord = (n: number): string => `${n} ${n === 1 ? 'face' : 'faces'}`

const tiles = computed(() =>
  lastViewed.value
    ? [
        lastViewed.value,
        ...(picks.value ?? []).filter((p) => p.imageId !== lastViewed.value!.imageId)
      ]
    : (picks.value ?? [])
)
const big = computed(() => (chosen.value ? props.photo(chosen.value.imageId) : null))
const face = computed(() => faces.value?.[at.value] ?? null)
const named = computed(() => faces.value?.filter((f) => f.source === 'ref').length ?? 0)
const emptyText = computed(() => pickEmptyText(props.scan ?? null))

// The list under the name field: matching people, then "New person" when the name is new
const match = computed(() => matchPeople(props.people, query.value))
const options = computed<Array<{ person: Person } | { newName: string }>>(() => [
  ...match.value.matches.map((person) => ({ person })),
  ...(query.value.trim() && !match.value.exact ? [{ newName: query.value.trim() }] : [])
])
type Option = (typeof options.value)[number]
const keyOf = (o: Option): string => ('person' in o ? o.person.id : 'new')
const hi = computed(() => options.value.findIndex((o) => keyOf(o) === hiKey.value))
const highlight = (i: number): void => {
  const o = options.value[i]
  hiKey.value = o ? keyOf(o) : null
}

async function loadPicks(quiet = false): Promise<void> {
  if (!quiet) picks.value = null
  picksFailed.value = false
  const [list, last] = await Promise.all([
    props.api.pickPhotos(props.albumId, 6).catch(() => null),
    props.lastViewedId
      ? props.api.facesInImage(props.albumId, props.lastViewedId).catch(() => [])
      : Promise.resolve([] as Face[])
  ])
  if (last.length && props.lastViewedId && props.photo(props.lastViewedId))
    lastViewed.value = { imageId: props.lastViewedId, path: '', faceCount: last.length }
  picksFailed.value = !list && !lastViewed.value
  picks.value = (list ?? []).filter((p) => props.photo(p.imageId))
  await nextTick()
  dlg.value?.querySelector<HTMLElement>('.pp-tile, .pp-empty .btn')?.focus()
}

onMounted(() => {
  dlg.value?.showModal()
  loadPicks()
})

// While faces are still being found, photos to pick appear here as they are ready
watch(
  () => props.scan?.processed,
  () => {
    if (picks.value && !tiles.value.length && !picksFailed.value && !chosen.value) loadPicks(true)
  }
)

// False when another photo was chosen meanwhile: its faces aren't this one's
async function loadFaces(): Promise<boolean> {
  const id = chosen.value?.imageId
  if (id === undefined) return false
  const list = byPosition(await props.api.facesInImage(props.albumId, id).catch(() => []))
  if (chosen.value?.imageId !== id) return false
  faces.value = list
  return true
}

async function choose(p: PickPhoto): Promise<void> {
  chosen.value = p
  faces.value = null
  at.value = -1
  if (!(await loadFaces())) return
  openFace(nextToName(faces.value ?? [], -1))
}

async function openFace(i: number): Promise<void> {
  at.value = i
  query.value = ''
  // The app's guess is ready to accept with Enter
  const guess = faces.value?.[i]?.personId
  hiKey.value = guess ?? null
  await nextTick()
  if (i < 0) doneBtn.value?.focus()
  else nameIn.value?.focus()
}

async function save(target: FaceTarget): Promise<void> {
  const f = face.value
  if (!f || busy.value) return
  busy.value = true
  savingAt.value = 'none' in target ? 'not' : hiKey.value
  try {
    // contextBridge can't clone Vue reactive proxies: send a plain copy
    const r = await props.api.assignFace(props.albumId, f.faceId, { ...target })
    if (!r.success) throw new Error(r.error)
    emit('changed')
    if (!(await loadFaces())) return
    const list = faces.value ?? []
    openFace(
      nextToName(
        list,
        list.findIndex((x) => x.faceId === f.faceId)
      )
    )
  } catch (err) {
    // The field keeps the name and the focus: Enter, or Try again, saves it again
    toast(`Couldn't save the name: ${err instanceof Error ? err.message : String(err)}`, {
      label: 'Try again',
      run: () => save(target)
    })
    nameIn.value?.focus()
  } finally {
    busy.value = false
    savingAt.value = null
  }
}

function pick(o: Option | undefined): void {
  if (busy.value) return
  if (!o) {
    // Enter with no name: skip to the next face without one
    const next = nextToName(faces.value ?? [], at.value)
    openFace(next === at.value ? -1 : next)
    return
  }
  save('person' in o ? { personId: o.person.id } : { newName: o.newName })
}

function onNameKey(e: KeyboardEvent): void {
  const n = options.value.length
  if (e.key === 'ArrowDown' && n) highlight((hi.value + 1) % n)
  else if (e.key === 'ArrowUp' && n) highlight(hi.value <= 0 ? n - 1 : hi.value - 1)
  else return
  e.preventDefault()
}

// Typing filters the list; the best match is the one Enter takes
function onInput(): void {
  highlight(query.value.trim() ? 0 : -1)
}

function back(): void {
  chosen.value = null
  at.value = -1
}

// Esc closes the name field first, then the view
function onCancel(): void {
  if (at.value >= 0) openFace(-1)
  else emit('close')
}

const boxStyle = (f: Face): Record<string, string> => ({
  left: `${f.box[0] * 100}%`,
  top: `${f.box[1] * 100}%`,
  width: `${f.box[2] * 100}%`,
  height: `${f.box[3] * 100}%`
})
// The name field sits under the face, or over it near the bottom; kept inside the photo's sides
const fieldStyle = computed(() => {
  const f = face.value
  if (!f) return {}
  const [x, y, w, h] = f.box
  const cx = x + w / 2
  const below = y + h < 0.6
  return {
    left: `${cx * 100}%`,
    ...(below
      ? { top: `calc(${(y + h) * 100}% + 10px)` }
      : { bottom: `calc(${(1 - y) * 100}% + 10px)` }),
    transform: `translateX(${cx < 0.2 ? -15 : cx > 0.8 ? -85 : -50}%)`
  }
})
const label = (f: Face): string => (f.name ? (f.source === 'ref' ? f.name : `${f.name}?`) : '')
</script>

<template>
  <dialog
    ref="dlg"
    class="pp"
    aria-labelledby="pp-title"
    @cancel.prevent="onCancel"
    @click.self="emit('close')"
  >
    <div class="pp-h">
      <div>
        <h2 id="pp-title">
          {{ chosen ? 'Click a face to name it' : 'Pick a photo of the people who matter' }}
        </h2>
        <small>Name them once. LumoSnap finds their other photos.</small>
      </div>
      <button class="icon-btn sm plain" aria-label="Close" @click="emit('close')"><X /></button>
    </div>

    <!-- 1. Choose a photo -->
    <div v-if="!chosen" class="pp-b">
      <div v-if="!picks" class="pp-grid" aria-busy="true">
        <div v-for="i in 6" :key="i" class="pp-tile skel"></div>
      </div>
      <div v-else-if="picksFailed" class="pp-empty" role="alert">
        <p>Couldn't load the photos to pick from.</p>
        <button class="btn ghost" @click="loadPicks()">Try again</button>
      </div>
      <p v-else-if="!tiles.length" class="pp-empty" aria-live="polite">{{ emptyText }}</p>
      <div v-else class="pp-grid">
        <button
          v-for="(p, i) in tiles"
          :key="p.imageId"
          class="pp-tile"
          :aria-label="`${i === 0 && lastViewed ? 'The photo you last opened' : 'Photo'}, ${facesWord(p.faceCount)}`"
          @click="choose(p)"
        >
          <img :src="photo(p.imageId)?.src" alt="" loading="lazy" />
          <span class="cap num">
            {{ i === 0 && lastViewed ? 'Last opened · ' : '' }}{{ facesWord(p.faceCount) }}
          </span>
        </button>
      </div>
    </div>

    <!-- 2. Name the faces -->
    <template v-else>
      <div class="pp-stage">
        <div
          v-if="big"
          class="pp-photo"
          :style="{ '--ar': big.aspect, backgroundImage: `url(${JSON.stringify(big.src)})` }"
          @click.self="openFace(-1)"
        >
          <button
            v-for="(f, i) in faces"
            :key="f.faceId"
            class="pp-face"
            :class="{ on: i === at, named: f.source === 'ref', guess: f.source === 'auto' }"
            :aria-label="
              f.name ? `${f.name}${f.source === 'ref' ? '' : '?'}, change` : 'Name this face'
            "
            :aria-pressed="i === at"
            :style="boxStyle(f)"
            @click="openFace(i)"
          >
            <span v-if="f.name && i !== at">{{ label(f) }}</span>
          </button>

          <form
            v-if="face"
            class="pp-name"
            :style="fieldStyle"
            :aria-busy="busy"
            @submit.prevent="pick(options[hi])"
          >
            <input
              ref="nameIn"
              v-model="query"
              class="input"
              role="combobox"
              aria-label="Who is this?"
              aria-controls="pp-opts"
              aria-autocomplete="list"
              :aria-expanded="options.length > 0"
              :aria-activedescendant="hi >= 0 ? `pp-o${hi}` : undefined"
              placeholder="Who is this?"
              autocomplete="off"
              spellcheck="false"
              maxlength="120"
              :readonly="busy"
              @input="onInput"
              @keydown="onNameKey"
            />
            <!-- Readonly, not disabled, while saving: the field keeps the focus for the next name -->
            <ul v-if="options.length" id="pp-opts" role="listbox" aria-label="People">
              <li
                v-for="(o, i) in options"
                :id="`pp-o${i}`"
                :key="keyOf(o)"
                role="option"
                :aria-selected="i === hi"
                @pointerdown.prevent
                @click="!busy && pick(o)"
                @pointermove="hiKey = keyOf(o)"
              >
                <template v-if="'person' in o">
                  <span class="avatar face" :style="faceStyle(o.person)"></span>{{ o.person.name }}
                  <Check
                    v-if="face.personId === o.person.id && face.source === 'ref'"
                    class="cur"
                  />
                </template>
                <template v-else><Plus />New person “{{ o.newName }}”</template>
                <span v-if="savingAt === keyOf(o)" class="spin" aria-hidden="true"></span>
              </li>
            </ul>
            <button
              v-if="face.personId && face.name"
              type="button"
              class="not"
              :disabled="busy"
              @click="save({ none: true })"
            >
              Not {{ face.name }}
              <span v-if="savingAt === 'not'" class="spin" aria-hidden="true"></span>
            </button>
          </form>
        </div>
      </div>
      <div class="pp-f">
        <span class="num" aria-live="polite">
          <span v-if="!faces" class="pp-finding"
            ><span class="spin now"></span>Finding the faces in this photo…</span
          >
          <template v-else>
            {{
              faces.length
                ? named === faces.length
                  ? 'Everyone here is named'
                  : `${named} of ${facesWord(faces.length)} named`
                : 'No faces found in this photo. Pick another one.'
            }}
          </template>
        </span>
        <span class="keys" aria-hidden="true">
          <kbd>Enter</kbd> saves and goes to the next face · with no name, skips it
        </span>
        <button class="btn ghost" @click="back">Other photo</button>
        <button ref="doneBtn" class="btn primary" @click="emit('close')">Done</button>
      </div>
    </template>
  </dialog>
</template>

<style scoped>
/* Big enough to see who is who in a group photo; grey around it like the gallery canvas */
.pp {
  width: min(1180px, calc(100vw - 64px));
  height: calc(100vh - 64px);
  max-width: none;
  max-height: none;
  display: none;
  flex-direction: column;
}
.pp[open] {
  display: flex;
}
.pp-h {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 16px 16px 24px;
}
.pp-h h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 400;
  letter-spacing: -0.01em;
}
.pp-h small {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: var(--ink-3);
}
.pp-h > .icon-btn:last-child {
  margin-left: auto;
}
.pp-b {
  flex: 1;
  overflow: auto;
  padding: 0 24px 24px;
}
.pp-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.pp-tile {
  position: relative;
  aspect-ratio: 3 / 2;
  padding: 0;
  border: 0;
  border-radius: var(--r-inset);
  overflow: hidden;
  background: var(--inset-2);
}
.pp-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.22s var(--ease);
}
.pp-tile:hover img {
  transform: scale(1.02);
}
.pp-tile:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
}
.pp-tile .cap {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 10px;
  border-radius: 99px;
  background: oklch(21% 0.01 255 / 0.72);
  color: white;
  font-size: 12px;
}
.pp-empty {
  max-width: 46ch;
  margin: 48px auto;
  text-align: center;
  color: var(--ink-2);
  font-size: 14px;
}
.pp-empty p {
  margin: 0 0 16px;
}

/* The photo fills the stage at its own shape; face boxes are placed in % of it */
.pp-stage {
  flex: 1;
  min-height: 0;
  margin: 0 24px;
  display: grid;
  place-items: center;
  container-type: size;
}
.pp-photo {
  position: relative;
  width: min(100cqw, 100cqh * var(--ar));
  aspect-ratio: var(--ar);
  border-radius: var(--r-inset);
  background: var(--inset-2) center / cover no-repeat;
  overflow: visible;
}
.pp-face {
  position: absolute;
  padding: 0;
  border: 2px dashed oklch(100% 0 0 / 0.85);
  border-radius: min(10px, 30%);
  background: none;
  box-shadow: 0 0 0 1px oklch(0% 0 0 / 0.3);
}
/* A face far back in the crowd is small: the click area stays at least 32 px */
.pp-face::after {
  content: '';
  position: absolute;
  inset: min(0px, (100% - 32px) / 2);
}
.pp-face.named {
  border-style: solid;
}
.pp-face:hover,
.pp-face:focus-visible {
  background: oklch(100% 0 0 / 0.1);
  outline: none;
}
.pp-face.on {
  border: 3px solid white;
  box-shadow:
    0 0 0 1px oklch(0% 0 0 / 0.3),
    0 0 0 6px oklch(100% 0 0 / 0.3);
}
.pp-face span {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translate(-50%, 6px);
  padding: 2px 10px;
  border-radius: 99px;
  background: var(--card);
  color: var(--ink);
  font-size: 13px;
  white-space: nowrap;
  box-shadow: 0 2px 8px oklch(0% 0 0 / 0.2);
}
/* A guess: dashed like an unnamed face, with the name as a question */
.pp-face.guess {
  border-style: dashed;
}
.pp-face.guess span {
  color: var(--ink-2);
}

/* The name field: a small card at the face */
.pp-name {
  position: absolute;
  z-index: 1;
  width: 240px;
  padding: 8px;
  border-radius: var(--r-inset);
  background: var(--card);
  box-shadow: 0 16px 40px -12px oklch(0% 0 0 / 0.45);
}
.pp-name .input {
  width: 100%;
}
.pp-name li {
  position: relative;
}
/* Over the end of the label, so a long name does not wrap while it saves */
.pp-name li .spin {
  position: absolute;
  right: 10px;
  box-shadow: 0 0 0 6px var(--inset);
  background: var(--inset);
}
.pp-name .not {
  display: flex;
  align-items: center;
}
.pp-name .not .spin {
  margin-left: auto;
}
/* Shows only when the faces take longer than 300 ms, with its spinner */
.pp-finding {
  /* the wrapper waits; the spinner inside is .now so it does not wait twice */
  display: inline-flex;
  align-items: center;
  gap: 8px;
  animation: spin-wait 0.3s;
}
.pp-name[aria-busy='true'] li {
  cursor: progress;
}
.pp-name ul {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 228px;
  overflow: auto;
}
.pp-name li {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
}
.pp-name li[aria-selected='true'] {
  background: var(--inset);
}
.pp-name li svg {
  width: 16px;
  height: 16px;
  margin: 0 4px;
  color: var(--ink-3);
}
.pp-name li .cur {
  margin-left: auto;
  color: var(--brand);
}
.pp-name .avatar {
  width: 24px;
  height: 24px;
}
.pp-name .not {
  width: 100%;
  margin-top: 6px;
  padding: 8px;
  border: 0;
  border-top: 1px solid var(--line);
  background: none;
  color: var(--ink-2);
  font-size: 13px;
  text-align: left;
}
.pp-f {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 24px 20px;
}
.pp-f > span {
  font-size: 13px;
  color: var(--ink-3);
}
.pp-f > span:first-child {
  margin-right: auto;
}
.keys {
  margin-right: 8px;
  font-size: 12px;
}
kbd {
  display: inline-grid;
  place-items: center;
  height: 20px;
  padding: 0 6px;
  margin-right: 2px;
  border-radius: 6px;
  background: var(--inset-2);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
}
</style>
