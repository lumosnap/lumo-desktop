<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Modal from '../components/ui/Modal.vue'
import NotesSidebar from '../components/NotesSidebar.vue'
import PeoplePick from '../components/PeoplePick.vue'
import PeopleReview from '../components/PeopleReview.vue'
import { toast } from '../composables/useToast'
import { useNetworkStore } from '../stores/network'
import {
  ArrowLeft,
  Heart,
  RefreshCw,
  RotateCw,
  Link,
  Copy,
  Check,
  X,
  ExternalLink,
  FolderOpen,
  Folder,
  FolderPlus,
  Layers,
  Plus,
  Minus,
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Tag,
  SlidersHorizontal,
  ScanFace,
  UserRound,
  EyeOff,
  NotebookPen,
  Image as ImageIcon
} from 'lucide-vue-next'
import PrivateNote from '../components/PrivateNote.vue'
import { noteState, withNoteState, type NoteFilter } from '../utils/notes'
import PhotoTile from '../components/PhotoTile.vue'
import PhotoSwipeLightbox from 'photoswipe/lightbox'
import type PhotoSwipe from 'photoswipe'
import type { SlideData } from 'photoswipe'
import 'photoswipe/style.css'
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/vue-virtual'
import {
  columnsForWidth,
  flattenRows,
  orderForGrouping,
  inSet,
  moved,
  momentSetName,
  GRID_GAP,
  type GroupableImage,
  type Row,
  type Tile
} from '../utils/grid'
import {
  tagLabel,
  tagCounts,
  tagCountsFor,
  withTags,
  searchTags,
  slugify,
  retag,
  groupVocab,
  pickerGroups,
  listSome,
  tagSavePlan,
  sameSet,
  PRESETS,
  presetSlugs,
  type AlbumTagConfig
} from '../utils/tags'
import {
  faceCrop,
  withPeople,
  type Box,
  type Face,
  type FaceTarget,
  type PeopleApi,
  type PeopleConfig,
  type Person
} from '../utils/people'

const route = useRoute()
const networkStore = useNetworkStore()
const albumId = route.params.id as string

const getDisplayStatus = (status: string): 'Processing' | 'Failed' | 'Success' => {
  if (['pending', 'compressing', 'uploading'].includes(status)) return 'Processing'
  if (['failed', 'failed_compression', 'failed_upload'].includes(status)) return 'Failed'
  return 'Success'
}

interface Comment {
  clientName: string
  notes: string | null
  createdAt: string
}

interface Image extends GroupableImage {
  id: number
  originalFilename: string
  localFilePath: string
  fileSize: number
  width: number
  height: number
  uploadStatus: string
  isFavorite?: boolean
  favoriteCount?: number
  notesCount?: number
  comments?: Comment[]
  favoritedBy?: string[] // client names who favorited this image
  tags?: string[]
  people?: string[] // person ids
}

interface Album {
  id: string
  title: string
  eventDate?: string | null
  totalImages?: number
  sourceFolderPath?: string
  needsSync?: number
  isOrphaned?: number
}

const nf = (n: number): string => n.toLocaleString()
const firstName = (s: string): string => s.split(' ')[0]
const initials = (s: string): string =>
  s
    .split(/\s|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')

const album = ref<Album | null>(null)
const images = ref<Image[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showFavoritesOnly = ref(false)
const gridLoading = ref(false)

// Client filter ("Picked by")
const clientNames = ref<string[]>([])
const selectedClientName = ref<string>('')
const isFavoritesLoaded = ref(false)
const isLoadingFavorites = ref(false)
// The photographer's private notes by photo, when each photo was marked done, and the
// filter to noted photos still to do (open) or done
const privateNotes = ref<Record<number, string>>({})
const doneAt = ref<Record<number, number>>({})
const noteFilter = ref<NoteFilter>(null)

// Share link
const showShareModal = ref(false)
const shareLink = ref('')
const isGeneratingLink = ref(false)
const copied = ref(false)
const showShareNext = ref(false)

// Notes panel
const showNotesSidebar = ref(false)
const currentNotesImage = ref<Image | null>(null)
const notesTab = ref<'client' | 'mine'>('client')
let notesReturnFocus: HTMLElement | null = null

// Lightbox: slides come from this array, since tiles may be virtualized away
let lightbox: PhotoSwipeLightbox | null = null
let lbItems: Image[] = []
let lbFromGrid = false // false while browsing one burst's frames
const galleryEl = ref<HTMLElement | null>(null)

// "Picked by" tooltip
const tip = ref<{ left: number; top: number; names: string[] } | null>(null)

// Virtualized rows, scrolled by AppLayout's #main
const scrollEl = ref<HTMLElement | null>(null)
const columns = ref(4)
const galleryWidth = ref(0)
const galleryTop = ref(0) // the gallery's offset in the scroller
const scrollPad = ref(0) // the scroller's top padding, where sticky things stop
// Sets, tags and the selection bar stay pinned over the photos
const headEl = ref<HTMLElement | null>(null)
const headH = ref(0)
const stackBursts = ref(true)

// Selection
const selectedImageIds = ref<Set<number>>(new Set())
const isSelectionMode = computed(() => selectedImageIds.value.size > 0)
const copying = ref(false)

// A stacked burst selects and deselects as a whole
const tileIds = (tile: Tile<Image>): number[] => (tile.burst ?? [tile.image]).map((i) => i.id)
const isTileSelected = (tile: Tile<Image>): boolean =>
  tileIds(tile).every((id) => selectedImageIds.value.has(id))

function toggleTile(tile: Tile<Image>): void {
  const on = isTileSelected(tile)
  const next = new Set(selectedImageIds.value)
  for (const id of tileIds(tile)) {
    if (on) next.delete(id)
    else next.add(id)
  }
  selectedImageIds.value = next
}

function selectAll(): void {
  selectedImageIds.value = new Set([
    ...selectedImageIds.value,
    ...filteredImages.value.map((img) => img.id)
  ])
}

function clearSelection(): void {
  selectedImageIds.value = new Set()
}

async function copySelectedImages(): Promise<void> {
  if (selectedImageIds.value.size === 0 || copying.value) return
  copying.value = true
  try {
    const result = await window.api.albums.copyImages(albumId, Array.from(selectedImageIds.value))
    if (result.success) {
      const missing = result.errorCount
        ? ` ${nf(result.errorCount)} originals weren't found in the album folder.`
        : ''
      const dir = result.destinationDir
      toast(
        `Copied ${nf(result.count || 0)} photos.${missing}`,
        dir ? { label: 'Show in Finder', run: () => window.api.shell.openFolder(dir) } : undefined
      )
      clearSelection()
    } else if (result.error !== 'Operation canceled') {
      toast(`Couldn't copy the photos: ${result.error}`)
    }
  } catch (err) {
    toast(`Couldn't copy the photos: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    copying.value = false
  }
}

// Sets: photographer-defined groups. The grid shows one set (or all photos), then picks on top.
type SetsResult = Awaited<ReturnType<typeof window.api.sets.list>>
type AlbumSet = Extract<SetsResult, { success: true }>['sets'][number]
const sets = ref<AlbumSet[]>([])
const activeSetId = ref<string | null>(null)
const activeSet = computed(() => sets.value.find((s) => s.id === activeSetId.value) ?? null)

function applySets(result: SetsResult): boolean {
  if (!result.success) {
    toast(`Couldn't update sets: ${result.error}`)
    return false
  }
  sets.value = result.sets
  if (activeSetId.value && !activeSet.value) activeSetId.value = null
  return true
}

async function setsCall(call: Promise<SetsResult>, done?: string): Promise<boolean> {
  try {
    const ok = applySets(await call)
    if (ok && done) toast(done)
    return ok
  } catch (err) {
    toast(`Couldn't update sets: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

const loadSets = (): Promise<boolean> => setsCall(window.api.sets.list(albumId))

function viewSet(id: string | null): void {
  activeSetId.value = id
  closePop()
}

// One popover at a time: a set's menu, "Add to set", or a name prompt
type Pop =
  | { kind: 'set'; set: AlbumSet }
  | { kind: 'add' }
  | {
      kind: 'name'
      label: string
      name: string
      submit: (name: string) => Promise<boolean>
      placeholder?: string
    }
  | { kind: 'tags'; ids: number[]; query: string }
  | { kind: 'person'; person: Person }
  | { kind: 'merge'; person: Person }
  | { kind: 'face'; face: Face; imageId: number }
  | { kind: 'link'; client: string }
  | { kind: 'people' }
const pop = ref<Pop | null>(null)
const popStyle = ref<Record<string, string>>({})
const popEl = ref<HTMLElement>()
// The one change being saved, by key ('name', 'face:p3', …): its control shows a spinner,
// the rest wait, and a second click does nothing. ponytail: one at a time for the whole view.
const pending = ref<string | false>(false)
let popReturn: HTMLElement | null = null // focus goes back here on Esc or after an action

async function openPop(p: Pop, e?: Event): Promise<void> {
  if (e) {
    popReturn = e.currentTarget as HTMLElement
    const r = popReturn.getBoundingClientRect()
    const up = r.bottom + (p.kind === 'tags' || p.kind === 'merge' ? 420 : 240) > innerHeight
    popStyle.value = {
      left: `${Math.max(8, Math.min(r.left, innerWidth - 288))}px`,
      ...(up ? { bottom: `${innerHeight - r.top + 6}px` } : { top: `${r.bottom + 6}px` })
    }
  }
  pop.value = p
  await nextTick()
  ;(popEl.value?.querySelector('input') ?? popEl.value?.querySelector('button'))?.focus()
}

function closePop(restoreFocus = false): void {
  pop.value = null
  if (restoreFocus && popReturn?.isConnected) popReturn.focus()
}
// The user scrolling the page closes a popover; scrolling inside one (the tag list) doesn't.
// Wheel/touch rather than scroll events: grid refreshes restore scroll position programmatically.
function onDocScroll(e: Event): void {
  if (!(e.target as Element).closest?.('.menu')) closePop()
}

// Without an event the prompt takes the place of the popover that's open
function promptName(
  label: string,
  name: string,
  submit: (name: string) => Promise<boolean>,
  e?: Event,
  placeholder?: string
): void {
  openPop({ kind: 'name', label, name, submit, placeholder }, e)
}

async function run(key: string, call: () => Promise<boolean>): Promise<boolean> {
  if (pending.value) return false
  pending.value = key
  try {
    return await call()
  } finally {
    pending.value = false
  }
}
// A menu item that saves: the menu stays open with a spinner on it, and closes when it worked.
// When it fails the menu is still there to try again.
async function popRun(key: string, call: () => Promise<boolean>): Promise<void> {
  const p = pop.value
  if ((await run(key, call)) && pop.value === p) closePop(true)
}
const lockedFor = (key: string): boolean => !!pending.value && pending.value !== key
const menuBusy = (key: string): Record<string, boolean | undefined> => ({
  'aria-busy': pending.value === key || undefined,
  'aria-disabled': lockedFor(key) || undefined
})

async function submitName(): Promise<void> {
  const p = pop.value
  if (p?.kind !== 'name' || !p.name.trim()) return
  await popRun('name', () => p.submit(p.name.trim()))
}

function onDocPointer(e: PointerEvent): void {
  const t = e.target as HTMLElement
  if (pop.value && !t.closest?.('.menu, [aria-haspopup]')) closePop()
}
function onDocKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && pop.value) closePop(true)
}

function newSet(e: Event): void {
  promptName(
    'New set',
    '',
    (name) =>
      setsCall(
        window.api.sets.create(albumId, name),
        `Created “${name}”. Select photos and choose Add to set.`
      ),
    e
  )
}

function renameSet(set: AlbumSet): void {
  promptName('Rename set', set.name, (name) => setsCall(window.api.sets.rename(set.id, name)))
}

// Moves at once; put back if the save fails
async function moveSet(set: AlbumSet, delta: number): Promise<void> {
  closePop()
  const before = sets.value
  const order = moved(
    before.map((s) => s.id),
    set.id,
    delta
  )
  const byId = new Map(before.map((s) => [s.id, s]))
  sets.value = order.flatMap((id) => byId.get(id) ?? [])
  if (!(await setsCall(window.api.sets.reorder(albumId, [...order])))) sets.value = before
}

const selectedIds = (): number[] => Array.from(selectedImageIds.value)
const photos = (n: number): string => `${nf(n)} ${n === 1 ? 'photo' : 'photos'}`

function addSelectedTo(set: AlbumSet): Promise<void> {
  const ids = selectedIds()
  return popRun(`add:${set.id}`, async () => {
    const ok = await setsCall(
      window.api.sets.addImages(set.id, [...ids]),
      `Added ${photos(ids.length)} to “${set.name}”`
    )
    if (ok) clearSelection()
    return ok
  })
}

function newSetFromSelection(): void {
  const ids = selectedIds()
  promptName('New set', '', async (name) => {
    const ok = await setsCall(
      window.api.sets.create(albumId, name, [...ids]),
      `Added ${photos(ids.length)} to “${name}”`
    )
    if (ok) clearSelection()
    return ok
  })
}

async function removeSelectedFromSet(): Promise<void> {
  const set = activeSet.value
  if (!set) return
  const ids = selectedIds()
  const ok = await run('set-remove', () =>
    setsCall(
      window.api.sets.removeImages(set.id, [...ids]),
      `Removed ${photos(ids.length)} from “${set.name}”`
    )
  )
  if (ok) clearSelection()
}

async function useAsCover(): Promise<void> {
  const set = activeSet.value
  if (!set) return
  const ok = await run('set-cover', () =>
    setsCall(window.api.sets.setCover(set.id, selectedIds()[0]), `Cover for “${set.name}” set`)
  )
  if (ok) clearSelection()
}

function makeSetFromMoment(row: Extract<Row<Image>, { kind: 'header' }>, e: Event): void {
  promptName(
    'Make a set from this moment',
    momentSetName(row.label),
    (name) =>
      setsCall(
        window.api.sets.fromMoment(albumId, String(row.momentId), name),
        `Created “${name}”`
      ),
    e
  )
}

// Delete confirmation
const setToDelete = ref<AlbumSet | null>(null)
const deletingSet = ref(false)
function askDeleteSet(set: AlbumSet): void {
  closePop()
  setToDelete.value = set
}
async function confirmDeleteSet(): Promise<void> {
  const set = setToDelete.value
  if (!set || deletingSet.value) return
  deletingSet.value = true
  if (await setsCall(window.api.sets.delete(set.id), `Deleted “${set.name}”`))
    setToDelete.value = null
  deletingSet.value = false
}

// Capture-time order when the album has moments, else upload order
const orderedImages = computed(() => orderForGrouping(images.value))
// Set, picks, then people: the scope tag chips count over
const peopleScoped = computed(() => {
  const inView = inSet(orderedImages.value, activeSet.value?.imageIds ?? null)
  const picked = showFavoritesOnly.value ? inView.filter((img) => img.isFavorite) : inView
  return withPeople(picked, activePeople.value)
})
// Notes to do / done, over the view so far: the counts match what the filter shows
const stateOf = (img: Image): ReturnType<typeof noteState> =>
  noteState(img, privateNotes.value[img.id], doneAt.value[img.id])
const noteCounts = computed(() => {
  const n = { open: 0, done: 0 }
  for (const img of peopleScoped.value) {
    const st = stateOf(img)
    if (st) n[st]++
  }
  return n
})
const noteRows = [
  {
    state: 'open',
    label: 'To do',
    icon: NotebookPen,
    title: "Photos with a note you haven't marked done"
  },
  { state: 'done', label: 'Done', icon: Check, title: 'Photos whose notes you marked done' }
] as const
const scopedImages = computed(() =>
  withNoteState(peopleScoped.value, noteFilter.value, privateNotes.value, doneAt.value)
)
const filteredImages = computed(() => withTags(scopedImages.value, activeTags.value))

// Tag filter: chips for the most frequent tags in scope, all of them while searching
const activeTags = ref<string[]>([])
const tagQuery = ref('')
const hasTags = computed(
  () => images.value.some((img) => img.tags?.length) || !!tagConfig.value?.enabled
)
const tagChips = computed(() => {
  const counts = tagCounts(scopedImages.value)
  const shown = tagQuery.value ? searchTags(counts, tagQuery.value) : counts.slice(0, 10)
  // Active tags stay visible first, even when out of scope or not matching the search
  const n = new Map(counts)
  return [
    ...activeTags.value.map((t) => [t, n.get(t) ?? 0] as const),
    ...shown.filter(([t]) => !activeTags.value.includes(t))
  ]
})
function toggleTag(slug: string): void {
  const on = activeTags.value.includes(slug)
  activeTags.value = on ? activeTags.value.filter((t) => t !== slug) : [...activeTags.value, slug]
}
function clearTags(): void {
  activeTags.value = []
  tagQuery.value = ''
}

// Album tag set and manual tags
const tagsApi = window.api.tags
const tagConfig = ref<AlbumTagConfig | null>(null)
const vocabBySlug = computed(() => new Map(tagConfig.value?.vocabulary.map((t) => [t.slug, t])))
const labelOf = (slug: string): string => vocabBySlug.value.get(slug)?.label ?? tagLabel(slug)

async function loadTagConfig(): Promise<void> {
  try {
    tagConfig.value = await tagsApi.getAlbumConfig(albumId)
  } catch {
    // no tag set: the picker and album tags button stay hidden
  }
}

async function editTag(op: 'add' | 'remove', ids: number[], slug: string): Promise<boolean> {
  // Show it now; main's refetch (albums.onAnalyzed) confirms it, a failure puts it back
  const edit = retag(images.value, ids, slug, op)
  images.value = edit.images
  try {
    // contextBridge can't clone Vue reactive proxies: always send a plain copy
    const r = await tagsApi[op](albumId, [...ids], slug)
    if (!r.success) throw new Error(r.error)
    return true
  } catch (err) {
    images.value = edit.undo(images.value)
    toast(
      `Couldn't ${op} “${labelOf(slug)}”: ${err instanceof Error ? err.message : String(err)}`,
      {
        label: 'Try again',
        run: () => editTag(op, [...ids], slug)
      }
    )
    return false
  }
}

// Tag picker (popover): tags on the photos, the album's tag set by category, More tags, custom
const pickPop = computed(() => (pop.value?.kind === 'tags' ? pop.value : null))
const pickPresent = computed(() => {
  const p = pickPop.value
  return p ? searchTags(tagCountsFor(images.value, new Set(p.ids)), p.query) : []
})
const pickGroups = computed(() => {
  const p = pickPop.value
  const c = tagConfig.value
  if (!p || !c) return []
  const present = new Set(tagCountsFor(images.value, new Set(p.ids)).map(([t]) => t))
  const groups = pickerGroups(
    c.vocabulary.filter((t) => !present.has(t.slug)),
    c.enabled ?? c.pack,
    p.query
  )
  // Custom tags already used in this album
  const custom = searchTags(tagCounts(images.value), p.query)
    .filter(([t]) => !vocabBySlug.value.has(t) && !present.has(t))
    .map(([slug]) => ({ slug, label: tagLabel(slug), category: 'custom' }))
  return custom.length ? [...groups, { category: 'custom', label: 'Custom', tags: custom }] : groups
})
const pickCustom = computed(() => {
  const p = pickPop.value
  const slug = p ? slugify(p.query) : ''
  if (!slug || pickPresent.value.some(([t]) => t === slug)) return ''
  return pickGroups.value.some((g) => g.tags.some((t) => t.slug === slug)) ? '' : slug
})

function openTagPicker(ids: number[], e: Event): void {
  openPop({ kind: 'tags', ids, query: '' }, e)
}

async function pickAdd(slug: string): Promise<void> {
  const p = pickPop.value
  if (!p) return
  const ok = await run('tags', () => editTag('add', p.ids, slug))
  if (!ok) return
  if (p.ids.length > 1) toast(`Tagged ${photos(p.ids.length)} “${labelOf(slug)}”`)
  // Stay open for the next tag
  p.query = ''
  popEl.value?.querySelector('input')?.focus()
}

async function pickRemove(slug: string): Promise<void> {
  const p = pickPop.value
  if (!p) return
  const ok = await run('tags', () => editTag('remove', p.ids, slug))
  if (ok && p.ids.length > 1) toast(`Removed “${labelOf(slug)}” from ${photos(p.ids.length)}`)
  // The row is gone; keep the keyboard in the picker
  popEl.value?.querySelector('input')?.focus()
}

// Album tags dialog: event type, then (only if asked for) the tags themselves
const showTagSet = ref(false)
const draftEvent = ref('')
const tagDraft = ref<Set<string> | null>(null) // null = the event's suggested tags
const savingTagSet = ref(false)
const eventChanged = computed(() => draftEvent.value !== tagConfig.value?.eventType)
const draftOn = computed(() => tagDraft.value ?? new Set(tagConfig.value?.pack))
const draftIsPack = computed(
  () => !tagDraft.value || sameSet([...tagDraft.value], tagConfig.value?.pack ?? [])
)
const eventLabel = (id: string): string =>
  tagConfig.value?.eventTypes.find((e) => e.id === id)?.label ?? id
const packSummary = computed(() => listSome((tagConfig.value?.pack ?? []).map(labelOf)))
const tagSetGroups = computed(() => {
  const c = tagConfig.value
  if (!c) return []
  const pack = new Set(c.pack)
  return [
    ...groupVocab(c.vocabulary.filter((t) => pack.has(t.slug))),
    ...pickerGroups(
      c.vocabulary.filter((t) => !pack.has(t.slug)),
      []
    )
  ]
})

function openTagSet(): void {
  const c = tagConfig.value
  if (!c) return
  draftEvent.value = c.eventType
  tagDraft.value = c.enabled ? new Set(c.enabled) : null
  showTagSet.value = true
}
function toggleDraft(slug: string): void {
  const next = new Set(draftOn.value)
  if (!next.delete(slug)) next.add(slug)
  tagDraft.value = next
}
const isPreset = (exclude: string[]): boolean =>
  sameSet([...draftOn.value], presetSlugs(exclude, tagConfig.value?.pack ?? []))
async function saveTagSet(): Promise<void> {
  const c = tagConfig.value
  if (!c || savingTagSet.value) return
  // contextBridge can't clone Vue reactive proxies: the plan holds plain copies
  const plan = tagSavePlan(c, draftEvent.value, tagDraft.value && [...tagDraft.value])
  if (!plan.eventType && plan.enabled === undefined) return void (showTagSet.value = false)
  savingTagSet.value = true
  try {
    tagConfig.value = plan.eventType
      ? await tagsApi.setEventType(albumId, plan.eventType)
      : await tagsApi.setAlbumConfig(albumId, plan.enabled ?? null)
    showTagSet.value = false
    toast(
      plan.eventType
        ? `Now suggesting ${eventLabel(plan.eventType).toLowerCase()} tags. Photos update in a few seconds.`
        : 'Album tags saved. AI suggestions update in a few seconds.'
    )
  } catch (err) {
    toast(`Couldn't save album tags: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    savingTagSet.value = false
  }
}

// People: faces found on this computer. Off per album until the photographer turns it on.
const peopleApi: PeopleApi | undefined = window.api.people
const peopleCfg = ref<PeopleConfig | null>(null)
const people = ref<Person[]>([]) // named people only
const activePeople = ref<string[]>([])
const lastPerson = ref<string | null>(null) // the person the detail line under the faces is about
const clientLinks = ref<Record<string, string>>({})
const showPeopleOn = ref(false)
const showPeopleOff = ref(false)
const peopleBusy = ref(false)
const showPick = ref(false)
const reviewing = ref<Person | null>(null)
const personToRemove = ref<Person | null>(null)
const lastViewedId = ref<number | null>(null) // offered first in the pick view

const imageById = computed(() => new Map(images.value.map((img) => [img.id, img])))
const personById = computed(() => new Map(people.value.map((p) => [p.id, p])))
const toCheck = computed(() => people.value.filter((p) => p.reviewCount > 0))
const mergeAsk = ref<{ from: Person; into: Person } | null>(null)
const focusPerson = computed(() =>
  lastPerson.value && activePeople.value.includes(lastPerson.value)
    ? (personById.value.get(lastPerson.value) ?? null)
    : null
)
const personName = (p: Person | undefined | null): string => p?.name ?? 'This person'
const peopleNames = (ids: readonly string[]): string =>
  ids.flatMap((id) => personById.value.get(id)?.name ?? []).join(' + ')
const photoAspect = (id: number): number => {
  const img = imageById.value.get(id)
  return img?.width && img.height ? img.width / img.height : 0
}
const pickPhoto = (id: number): { src: string; aspect: number } | null => {
  const img = imageById.value.get(id)
  return img ? { src: `file://${img.localFilePath}`, aspect: photoAspect(id) || 1.5 } : null
}

/** Inline style that turns a .avatar into the person's face, cut from the cover thumbnail */
function faceStyle(p: Person | undefined | null): Record<string, string> | undefined {
  if (!p) return undefined
  return {
    backgroundImage: `url(${JSON.stringify(`file://${p.cover.path}`)})`,
    ...faceCrop(p.cover.box as Box, photoAspect(p.cover.imageId))
  }
}

// `retry` puts "Try again" on the toast, for changes whose control is gone by then
async function peopleCall(
  call: () => Promise<unknown>,
  what: string,
  retry?: () => void
): Promise<boolean> {
  try {
    const r = (await call()) as { success?: boolean; error?: string } | undefined
    if (r && r.success === false) throw new Error(r.error)
    return true
  } catch (err) {
    toast(
      `Couldn't ${what}: ${err instanceof Error ? err.message : String(err)}`,
      retry && { label: 'Try again', run: retry }
    )
    return false
  }
}

async function loadPeople(): Promise<void> {
  if (!peopleApi) return
  try {
    const cfg = await peopleApi.getConfig(albumId)
    if (!cfg.enabled) {
      peopleCfg.value = cfg
      people.value = []
      activePeople.value = []
      return
    }
    const [list, links] = await Promise.all([
      peopleApi.list(albumId),
      peopleApi.clientLinks(albumId)
    ])
    // Config and names land together: the card never shows "Pick people" before the names
    peopleCfg.value = cfg
    people.value = list
    clientLinks.value = links
    const ids = new Set(list.map((p) => p.id))
    if (activePeople.value.some((id) => !ids.has(id)))
      activePeople.value = activePeople.value.filter((id) => ids.has(id))
  } catch {
    // no people data: the card stays hidden
  }
}

// Progress has no event of its own: read it every few seconds while faces are being found
let peoplePoll: ReturnType<typeof setInterval> | null = null
watch(
  () => peopleCfg.value?.state,
  (st) => {
    const busy = st === 'waiting' || st === 'running' || st === 'paused'
    if (busy && !peoplePoll) peoplePoll = setInterval(loadPeople, 3000)
    if (!busy && peoplePoll) {
      clearInterval(peoplePoll)
      peoplePoll = null
    }
  }
)

function togglePerson(id: string): void {
  const on = activePeople.value.includes(id)
  activePeople.value = on ? activePeople.value.filter((x) => x !== id) : [...activePeople.value, id]
  lastPerson.value = on ? (activePeople.value.at(-1) ?? null) : id
  clearSelection()
  // The line to name this person sits under the faces: keep it in view in a long panel
  nextTick(() => document.querySelector('.face-focus')?.scrollIntoView({ block: 'nearest' }))
}

async function turnPeopleOn(): Promise<void> {
  if (!peopleApi || peopleBusy.value) return
  peopleBusy.value = true
  if (await peopleCall(() => peopleApi.setEnabled(albumId, true), 'turn on People')) {
    showPeopleOn.value = false
    await loadPeople()
  }
  peopleBusy.value = false
}

async function turnPeopleOff(): Promise<void> {
  if (!peopleApi || peopleBusy.value) return
  peopleBusy.value = true
  if (await peopleCall(() => peopleApi.setEnabled(albumId, false), 'turn off People')) {
    showPeopleOff.value = false
    clientLinks.value = {}
    faceCache.clear()
    await loadPeople()
    renderLbFaces()
    toast('People is off. Face data for this album is deleted.')
  }
  peopleBusy.value = false
}

async function afterPeopleEdit(): Promise<void> {
  faceCache.clear()
  await loadPeople()
  renderLbFaces()
}

function renamePerson(p: Person, e?: Event): void {
  promptName(
    'Rename',
    p.name,
    async (name) => {
      // A name already in use means the same person: merge, so there are never two Rahuls
      const same = people.value.find(
        (x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase()
      )
      if (same) return mergePerson(p, same)
      const ok = await peopleCall(() => peopleApi!.rename(albumId, p.id, name), 'save the name')
      if (ok) await afterPeopleEdit()
      return ok
    },
    e,
    'Name'
  )
}

async function mergePerson(from: Person, into: Person): Promise<boolean> {
  if (!(await peopleCall(() => peopleApi!.merge(albumId, into.id, [from.id]), 'merge')))
    return false
  activePeople.value = activePeople.value.map((id) => (id === from.id ? into.id : id))
  if (lastPerson.value === from.id) lastPerson.value = into.id
  toast(`Merged into ${personName(into)}`)
  await afterPeopleEdit()
  return true
}

// The confirm stays open with a spinner until the merge is saved
async function confirmMerge(): Promise<void> {
  const m = mergeAsk.value
  if (!m || peopleBusy.value) return
  peopleBusy.value = true
  if (await mergePerson(m.from, m.into)) mergeAsk.value = null
  peopleBusy.value = false
}

const setPersonHidden = (id: string, hidden: boolean): void => {
  people.value = people.value.map((x) => (x.id === id ? { ...x, hidden } : x))
}
// Hidden: the photographer still sees and filters them; the client gallery does not show them.
// The eye icon changes at once and goes back if the save fails.
async function hidePerson(p: Person, hidden: boolean): Promise<void> {
  closePop()
  setPersonHidden(p.id, hidden)
  const ok = await peopleCall(
    () => peopleApi!.setHidden(albumId, p.id, hidden),
    hidden ? `hide ${p.name}` : `show ${p.name}`,
    () => hidePerson(p, hidden)
  )
  if (!ok) return setPersonHidden(p.id, !hidden)
  toast(
    hidden
      ? `${p.name} is hidden from your client`
      : `${p.name} shows in your client's gallery again`,
    hidden ? { label: 'Undo', run: () => hidePerson(p, false) } : undefined
  )
  await afterPeopleEdit()
}

async function removePerson(): Promise<void> {
  const p = personToRemove.value
  if (!p || peopleBusy.value) return
  peopleBusy.value = true
  if (await peopleCall(() => peopleApi!.remove(albumId, p.id), 'remove')) {
    personToRemove.value = null
    activePeople.value = activePeople.value.filter((id) => id !== p.id)
    await afterPeopleEdit()
  }
  peopleBusy.value = false
}

const mergeTargets = computed(() => {
  const p = pop.value
  if (p?.kind !== 'merge') return []
  return people.value.filter((x) => x.id !== p.person.id)
})

// Client link: which named person a client is. Only the photographer sees it.
function linkClient(client: string, personId: string | null): Promise<void> {
  return popRun(`link:${personId}`, async () => {
    if (!(await peopleCall(() => peopleApi!.linkClient(albumId, client, personId), 'link')))
      return false
    const next = { ...clientLinks.value }
    if (personId) next[client] = personId
    else delete next[client]
    clientLinks.value = next
    return true
  })
}
const linkedPerson = (client: string): Person | undefined =>
  personById.value.get(clientLinks.value[client] ?? '')

// Faces in the lightbox: boxes over the photo, each opens "Who is this?"
const faceMode = ref(false)
const faceCache = new Map<number, Promise<Face[]>>()
const facesFor = (imageId: number): Promise<Face[]> => {
  let f = faceCache.get(imageId)
  if (!f) {
    f = peopleApi!.facesInImage(albumId, imageId).catch(() => [])
    faceCache.set(imageId, f)
  }
  return f
}

let lbFacesBtn: HTMLElement | null = null
async function renderLbFaces(): Promise<void> {
  const pswp = lightbox?.pswp
  if (!pswp) return
  const on = !!peopleCfg.value?.enabled
  if (lbFacesBtn) {
    lbFacesBtn.hidden = !on
    lbFacesBtn.setAttribute('aria-pressed', String(on && faceMode.value))
  }
  pswp.element?.querySelectorAll('.lb-faces').forEach((el) => el.remove())
  const slide = pswp.currSlide
  const img = slideImage(pswp)
  if (!on || !faceMode.value || !slide || !img) return
  const faces = await facesFor(img.id)
  if (pswp.currSlide !== slide || !faceMode.value) return
  const layer = document.createElement('div')
  layer.className = 'lb-faces'
  const el = slide.content.element
  layer.style.width = el?.style.width || `${slide.width * slide.zoomLevels.initial}px`
  layer.style.height = el?.style.height || `${slide.height * slide.zoomLevels.initial}px`
  for (const f of faces) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'lb-face' + (f.personId ? '' : ' none')
    const sure = f.source === 'ref' ? '' : '?'
    const [x, y, w, h] = f.box
    Object.assign(b.style, {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${w * 100}%`,
      height: `${h * 100}%`
    })
    b.setAttribute('aria-haspopup', 'dialog')
    b.setAttribute('aria-label', f.name ? `${f.name}${sure}, change` : 'Who is this?')
    if (f.name) {
      const n = document.createElement('span')
      n.textContent = f.name + sure
      b.append(n)
    }
    // PhotoSwipe reads a press on the photo as zoom or close
    b.onpointerdown = (e) => e.stopPropagation()
    b.onclick = (e) => openPop({ kind: 'face', face: f, imageId: img.id }, e)
    layer.append(b)
  }
  slide.container.append(layer)
}

async function assignFace(to: FaceTarget, faceId?: number): Promise<boolean> {
  const p = pop.value
  const id = faceId ?? (p?.kind === 'face' ? p.face.faceId : undefined)
  if (id === undefined) return false
  const ok = await peopleCall(() => peopleApi!.assignFace(albumId, id, to), 'save')
  if (ok) {
    closePop()
    await afterPeopleEdit()
  }
  return ok
}

function newPersonForFace(): void {
  const p = pop.value
  if (p?.kind !== 'face') return
  // The name prompt replaces the face menu, so carry the face id with the submit
  const { faceId } = p.face
  promptName('New person', '', (name) => assignFace({ newName: name }, faceId), undefined, 'Name')
}

function useFaceAsCover(): Promise<void> {
  const p = pop.value
  if (p?.kind !== 'face' || !p.face.personId) return Promise.resolve()
  const { personId, faceId, name } = p.face
  return popRun('cover', async () => {
    if (!(await peopleCall(() => peopleApi!.setCover(albumId, personId, faceId), 'set the face')))
      return false
    toast(`${name ?? 'This person'} now shows this face`)
    await afterPeopleEdit()
    return true
  })
}

const grid = computed(() =>
  flattenRows(filteredImages.value, { columns: columns.value, stackBursts: stackBursts.value })
)
const hasBursts = computed(() => images.value.some((img) => img.burstId != null))
const HEADER_H = 44

// scrollTop at which the bar pins
const stuckAt = computed(() => galleryTop.value - scrollPad.value - headH.value)
// The virtualizer sees the list start this much higher, so its "top" is the first row
// visible under the pinned bar and moment label: scrollToIndex lands rows there, and the
// sticky moment is the one those photos belong to
const scrollMargin = computed(
  () => stuckAt.value - (grid.value.headers.length ? HEADER_H + GRID_GAP : 0)
)

// Portrait 4:5 tiles, like the client gallery: vertical photos keep their faces, and the
// photographer sees the crop their client sees
const tileH = (): number =>
  galleryWidth.value
    ? (((galleryWidth.value - GRID_GAP * (columns.value - 1)) / columns.value) * 5) / 4
    : 240

// The moment header at or above the first visible row stays rendered so it can stick.
// Set inside rangeExtractor, read by virtualRows after the virtualizer notifies.
let activeHeader: number | null = null

const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: grid.value.rows.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: (i: number) => (grid.value.rows[i]?.kind === 'header' ? HEADER_H : tileH()),
    gap: GRID_GAP,
    overscan: 3,
    scrollMargin: scrollMargin.value,
    getItemKey: (i: number) => grid.value.rows[i]?.key ?? i,
    rangeExtractor: (range: Range) => {
      activeHeader = null
      for (const h of grid.value.headers) {
        if (h.row > range.startIndex) break
        activeHeader = h.row
      }
      const next = defaultRangeExtractor(range).filter((i) => i !== activeHeader)
      return activeHeader === null ? next : [activeHeader, ...next]
    }
  }))
)

const virtualRows = computed(() =>
  rowVirtualizer.value.getVirtualItems().map((v) => ({
    v,
    row: grid.value.rows[v.index],
    sticky: v.index === activeHeader
  }))
)

// Column count, row height and the gallery's offset in the scroller, kept in step with layout
function updateGridLayout(): void {
  const el = galleryEl.value
  if (!el) return
  scrollEl.value = el.closest('.main') as HTMLElement | null
  columns.value = columnsForWidth(el.clientWidth, window.innerWidth)
  galleryWidth.value = el.clientWidth
  const sc = scrollEl.value
  // While the bar is pinned, the row under it stays there when the bar or a banner changes height
  const pinned =
    sc && galleryTop.value && sc.scrollTop > stuckAt.value
      ? sc.scrollTop - scrollMargin.value
      : null
  headH.value = headEl.value?.offsetHeight ?? 0
  if (sc) {
    scrollPad.value = parseFloat(getComputedStyle(sc).paddingTop) || 0
    galleryTop.value =
      el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
    if (pinned !== null) sc.scrollTop = scrollMargin.value + pinned
  }
  rowVirtualizer.value.measure()
}

const resizeObserver = new ResizeObserver(() => updateGridLayout())
// AppLayout's offline / low-storage banners come and go above the gallery and shift it
const bannerObserver = new MutationObserver(() => updateGridLayout())
watch(
  galleryEl,
  (el) => {
    resizeObserver.disconnect()
    bannerObserver.disconnect()
    if (el) {
      resizeObserver.observe(el)
      // The selection bar and the tag row change its height, which moves the grid
      if (headEl.value) resizeObserver.observe(headEl.value)
      updateGridLayout()
      if (scrollEl.value) bannerObserver.observe(scrollEl.value, { childList: true })
    }
  },
  { flush: 'post' }
)
// A new set or filter starts from its first photo. The pinned bar stays put under the pointer.
watch(
  [activeSetId, activeTags, showFavoritesOnly, selectedClientName, activePeople, noteFilter],
  () => {
    const el = scrollEl.value
    if (el && el.scrollTop > stuckAt.value) el.scrollTop = stuckAt.value
  }
)

const currentHeader = computed(() => virtualRows.value.find((r) => r.sticky)?.v.index ?? null)

// Its first photos land under the bar, with its label pinned above them
function scrollToMoment(row: number): void {
  rowVirtualizer.value.scrollToIndex(row + 1, { align: 'start' })
}

const favoritedPhotosCount = computed(() => images.value.filter((img) => img.isFavorite).length)

// Per-client pick counts, taken from the unfiltered favorites response
const clientCounts = ref<Record<string, number>>({})

const processingCount = computed(
  () => images.value.filter((img) => getDisplayStatus(img.uploadStatus) === 'Processing').length
)

const statusLine = computed(() => {
  if (processingCount.value)
    return { dot: 'brand', text: `Adding ${nf(processingCount.value)} new` }
  if (album.value?.isOrphaned) return { dot: 'bad', text: 'Folder missing' }
  if (album.value?.needsSync) return { dot: 'warn', text: 'Folder changed' }
  return { dot: 'ok', text: 'Synced' }
})

const barTitle = computed(() => {
  const base = activeSet.value?.name
  const picks = !showFavoritesOnly.value
    ? (base ?? 'All photos')
    : selectedClientName.value
      ? `${firstName(selectedClientName.value)}'s picks`
      : 'Client picks'
  const head = base && showFavoritesOnly.value ? `${base} · ${picks}` : picks
  const withPeopleTitle = activePeople.value.length
    ? `${head} · with ${peopleNames(activePeople.value)}`
    : head
  return withPeopleTitle
})

const formattedEventDate = computed(() => {
  if (!album.value?.eventDate) return undefined
  return new Date(album.value.eventDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
})

// Thumbnail lives in a .thumbnails subfolder; falls back to the original on error
function getThumbnailPath(localFilePath: string): string {
  const lastSlash = localFilePath.lastIndexOf('/')
  if (lastSlash === -1) return localFilePath
  const dir = localFilePath.substring(0, lastSlash)
  const filename = localFilePath.substring(lastSlash + 1)
  return `${dir}/.thumbnails/${filename}`
}

async function loadAlbumImages(): Promise<void> {
  loading.value = true
  error.value = null
  isFavoritesLoaded.value = false

  try {
    const albumResult = await window.api.albums.get(albumId)
    if (albumResult.success) album.value = albumResult.album

    const imagesResult = await window.api.albums.getImages(albumId)
    if (imagesResult.success) {
      images.value = imagesResult.images || []
    } else {
      error.value = imagesResult.error || 'Failed to load images'
    }

    // Non-blocking: let the grid render before fetching picks
    setTimeout(() => {
      loadFavorites()
    }, 100)
    loadNotes()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to load album'
  } finally {
    loading.value = false
  }
}

// "Reload photos" once the grid is up: the photos stay on screen, scroll and picks are kept,
// and a failure is a toast instead of the error page
const reloading = ref(false)
async function reloadPhotos(): Promise<void> {
  if (reloading.value) return
  reloading.value = true
  try {
    const a = await window.api.albums.get(albumId)
    if (a.success) album.value = a.album
    if (!(await refreshGrouping())) throw new Error('the album did not answer')
    isFavoritesLoaded.value = false
    await loadFavorites(selectedClientName.value || undefined)
  } catch (err) {
    toast(`Couldn't reload the photos: ${err instanceof Error ? err.message : String(err)}`, {
      label: 'Try again',
      run: reloadPhotos
    })
  } finally {
    reloading.value = false
  }
}

// Grouping changed in main: swap in the new fields in place, keeping picks and scroll position
let offAnalyzed: (() => void) | null = null
let offSetsChanged: (() => void) | null = null
let offPeopleChanged: (() => void) | undefined
// Quiet: runs on its own after analysis, so a failure keeps the grid as it is
async function refreshGrouping(): Promise<boolean> {
  const result = await window.api.albums.getImages(albumId).catch(() => null)
  if (!result?.success || !result.images) return false
  const prev = new Map(images.value.map((img) => [img.id, img]))
  const top = scrollEl.value?.scrollTop
  images.value = result.images.map((img) => {
    const old = prev.get(img.id)
    return old
      ? {
          ...img,
          isFavorite: old.isFavorite,
          favoritedBy: old.favoritedBy,
          favoriteCount: old.favoriteCount,
          comments: old.comments,
          notesCount: old.notesCount
        }
      : img
  })
  await nextTick()
  if (scrollEl.value && top !== undefined) scrollEl.value.scrollTop = top
  return true
}

// Fetch picks and merge who-picked, notes and comments into the images
async function loadFavorites(clientNameFilter?: string): Promise<void> {
  if (isLoadingFavorites.value) return
  isLoadingFavorites.value = true

  try {
    const result = await window.api.api.getFavorites(albumId, clientNameFilter)
    if (result.success) {
      // Only the unfiltered response carries every client
      if (!clientNameFilter) {
        if (result.clientNames) clientNames.value = result.clientNames
        const counts: Record<string, number> = {}
        for (const fav of result.favorites || [])
          for (const name of new Set((fav.comments || []).map((c) => c.clientName)))
            counts[name] = (counts[name] || 0) + 1
        clientCounts.value = counts
      }

      const favMap = new Map<string, { by: string[]; comments: Comment[]; notesCount: number }>()
      for (const fav of result.favorites || []) {
        const comments = fav.comments || []
        favMap.set(getBaseName(fav.originalFilename), {
          by: [...new Set(comments.map((c) => c.clientName))],
          comments,
          notesCount: fav.notesCount || comments.filter((c) => c.notes?.trim()).length
        })
      }

      images.value = images.value.map((img) => {
        const fav = favMap.get(getBaseName(img.originalFilename))
        return {
          ...img,
          isFavorite: !!fav && fav.by.length > 0,
          favoritedBy: fav?.by || [],
          favoriteCount: fav?.by.length || 0,
          comments: fav?.comments || img.comments || [],
          notesCount: fav?.notesCount || img.notesCount || 0
        }
      })

      isFavoritesLoaded.value = true
    } else if (result.error) {
      toast(`Couldn't load client picks: ${result.error}`)
    }
  } catch (err) {
    toast(`Couldn't load client picks: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    isLoadingFavorites.value = false
  }
}

function getBaseName(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot > 0 ? filename.substring(0, lastDot) : filename
}

async function waitForFavorites(): Promise<void> {
  if (isFavoritesLoaded.value) return
  gridLoading.value = true
  if (!isLoadingFavorites.value) {
    await loadFavorites()
  } else {
    await new Promise<void>((resolve) => {
      const unwatch = watch(isLoadingFavorites, (v) => {
        if (!v) {
          unwatch()
          resolve()
        }
      })
    })
  }
  gridLoading.value = false
}

// Server-side client filter, as before: refetch favorites for that client
async function onClientFilterChange(): Promise<void> {
  gridLoading.value = true
  await loadFavorites(selectedClientName.value || undefined)
  gridLoading.value = false
}

async function viewAll(): Promise<void> {
  showFavoritesOnly.value = false
  if (selectedClientName.value) {
    selectedClientName.value = ''
    await onClientFilterChange()
  }
}

async function viewFav(): Promise<void> {
  await waitForFavorites()
  showFavoritesOnly.value = true
}

async function pickClient(name: string): Promise<void> {
  selectedClientName.value = selectedClientName.value === name ? '' : name
  showFavoritesOnly.value = true
  clearSelection()
  await onClientFilterChange()
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// Private notes: the photographer's own, on this computer only
const albumNote = ref('')
const notesLoaded = ref(false)
const showAlbumNote = ref(false)
const notesError = ref(false)
// Anything to show in the notes card; else it stays one line
const hasNotes = computed(
  () =>
    !!albumNote.value ||
    showAlbumNote.value ||
    !!noteFilter.value ||
    noteCounts.value.open + noteCounts.value.done > 0
)
function retryNotes(): void {
  notesError.value = false
  void loadNotes()
}
async function loadNotes(): Promise<void> {
  try {
    const r = await window.api.notes.get(albumId)
    if (!r.success) throw new Error(r.error)
    privateNotes.value = r.notes
    albumNote.value = r.albumNote
    doneAt.value = r.done
    notesLoaded.value = true
    notesError.value = false
  } catch (err) {
    notesError.value = !notesLoaded.value
    toast(`Couldn't load your notes: ${errText(err)}`, { label: 'Try again', run: loadNotes })
  }
}
async function saveImageNote(imageId: number, body: string): Promise<boolean> {
  const r = await window.api.notes.set(albumId, imageId, body)
  if (!r.success) return false
  const next = { ...privateNotes.value }
  if (body.trim()) next[imageId] = body
  else delete next[imageId]
  privateNotes.value = next
  return true
}
// Done: the note on a photo is handled. One key for the list, so a second press can't race it.
async function setDone(ids: number[], done: boolean): Promise<boolean> {
  return run(ids.length === 1 ? `done:${ids[0]}` : 'done-bulk', async () => {
    try {
      // contextBridge can't clone Vue proxies: send a plain array
      const r = await window.api.notes.setDone(albumId, [...ids], done)
      if (!r.success) throw new Error(r.error)
      const next = { ...doneAt.value }
      for (const id of ids) {
        if (done) next[id] = r.doneAt
        else delete next[id]
      }
      doneAt.value = next
      return true
    } catch (err) {
      // Stored on this computer only: the raw error (SQLite) helps no one; it goes to the log
      console.error('notes:setDone', errText(err))
      toast(`Couldn't ${done ? 'mark it done' : 'reopen it'} on this computer`, {
        label: 'Try again',
        run: () => void setDone(ids, done)
      })
      return false
    }
  })
}
const toggleDone = (img: Image): Promise<boolean> => setDone([img.id], stateOf(img) !== 'done')
// Selected photos with a note still to do: the selection bar offers to mark them done
const selectedOpen = computed(() =>
  images.value.filter((img) => selectedImageIds.value.has(img.id) && stateOf(img) === 'open')
)
async function markSelectedDone(): Promise<void> {
  const ids = selectedOpen.value.map((img) => img.id)
  if (!(await setDone(ids, true))) return
  toast(`${photos(ids.length)} marked done`, { label: 'Undo', run: () => void setDone(ids, false) })
}

async function saveAlbumNote(body: string): Promise<boolean> {
  const r = await window.api.notes.setAlbum(albumId, body)
  if (r.success) albumNote.value = body
  return r.success
}

async function generateShareLink(): Promise<void> {
  isGeneratingLink.value = true
  copied.value = false
  showShareNext.value = false

  const storageKey = `shareLink_album_${albumId}`
  const cachedLink = localStorage.getItem(storageKey)
  if (cachedLink) {
    shareLink.value = cachedLink
    showShareModal.value = true
    isGeneratingLink.value = false
    return
  }

  try {
    const result = await window.api.api.generateShareLink(albumId)
    if (result.success && result.shareLink) {
      shareLink.value = result.shareLink.shareUrl
      localStorage.setItem(storageKey, result.shareLink.shareUrl)
      showShareModal.value = true
    } else {
      toast(result.error || 'Failed to generate share link')
    }
  } catch (err: unknown) {
    toast(err instanceof Error ? err.message : 'Failed to generate share link')
  } finally {
    isGeneratingLink.value = false
  }
}

async function copyShareLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareLink.value)
  } catch {
    const textArea = document.createElement('textarea')
    textArea.value = shareLink.value
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
  copied.value = true
  showShareNext.value = true
  setTimeout(() => {
    copied.value = false
  }, 1800)
}

function openShareLink(): void {
  window.open(shareLink.value, '_blank')
}

async function showOriginalInFolder(image: Image): Promise<void> {
  try {
    const result = await window.api.shell.showItemInFolder(albumId, image.id)
    if (!result.success) toast(`Couldn't show ${image.originalFilename}: ${result.error}`)
  } catch (err) {
    toast(
      `Couldn't show ${image.originalFilename}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

async function showAlbumFolder(): Promise<void> {
  if (!album.value?.sourceFolderPath) return
  const result = await window.api.shell.openFolder(album.value.sourceFolderPath)
  if (!result.success) toast(`Couldn't open the folder: ${result.error}`)
}

function openNotesSidebar(image: Image, tab: 'client' | 'mine' = 'client'): void {
  notesReturnFocus = document.activeElement as HTMLElement | null
  notesTab.value = tab
  currentNotesImage.value = image
  showNotesSidebar.value = true
}

function closeNotesSidebar(): void {
  showNotesSidebar.value = false
  currentNotesImage.value = null
  notesReturnFocus?.focus()
}

function toSlide(image: Image): SlideData {
  return {
    src: `file://${image.localFilePath}`,
    msrc:
      getDisplayStatus(image.uploadStatus) === 'Failed'
        ? undefined
        : `file://${getThumbnailPath(image.localFilePath)}`,
    width: image.width || 1920,
    height: image.height || 1280,
    alt: image.originalFilename
  }
}

// In selection mode a click selects instead of opening the lightbox.
// A stacked burst opens over just its own frames.
function handleImageClick(event: MouseEvent, tile: Tile<Image>): void {
  if (isSelectionMode.value) {
    event.preventDefault()
    toggleTile(tile)
    return
  }
  // Modifier clicks keep the link's default, as PhotoSwipe's own handler did
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !lightbox) return
  event.preventDefault()
  lbFromGrid = !tile.burst
  lbItems = tile.burst ?? grid.value.tiles.map((t) => t.image)
  const start = tile.burst ? tile.burst.indexOf(tile.image) : tile.index
  lightbox.loadAndOpen(Math.max(0, start), lbItems.map(toSlide), {
    x: event.clientX,
    y: event.clientY
  })
}

const ICON = (paths: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

// The image behind the current PhotoSwipe slide
function slideImage(pswp: PhotoSwipe): Image | undefined {
  const id = lbItems[pswp.currIndex]?.id
  // Prefer the live copy, which picks up client picks merged in after opening
  return images.value.find((img) => img.id === id) ?? lbItems[pswp.currIndex]
}

let lbTagsEl: HTMLElement | null = null
// The lightbox bar names the photo's note (the start of yours, or the client's count) and
// whether it is done; pressing it opens the notes
let lbNoteEl: HTMLElement | null = null
function renderLbNote(): void {
  const el = lbNoteEl
  const pswp = lightbox?.pswp
  const img = pswp && slideImage(pswp)
  const st = img ? stateOf(img) : null
  if (!el) return
  el.hidden = !st
  if (!img || !st) return
  const mine = privateNotes.value[img.id]?.trim().split('\n')[0]
  const n = img.notesCount || 0
  const text = mine || `${n} note${n === 1 ? '' : 's'} from your client`
  el.classList.toggle('done', st === 'done')
  el.innerHTML = ICON(
    st === 'done'
      ? '<path d="M20 6 9 17l-5-5"/>'
      : mine
        ? '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>'
        : '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
  )
  const t = document.createElement('span')
  t.className = 't'
  t.textContent = text
  el.append(t)
  if (st === 'done') el.append(' · Done')
  el.setAttribute(
    'aria-label',
    `${mine ? `Your note: ${privateNotes.value[img.id]}` : text}. ${st === 'done' ? 'Done' : 'To do'}. Open notes`
  )
}
watch([privateNotes, doneAt, images], renderLbNote)
// PhotoSwipe traps focus in its root, so popovers move in there while it's open
const lbRoot = ref<HTMLElement | null>(null)

function renderLbTags(): void {
  const el = lbTagsEl
  const pswp = lightbox?.pswp
  if (!el || !pswp) return
  const img = slideImage(pswp)
  const hadFocus = el.contains(document.activeElement)
  el.replaceChildren()
  el.hidden = !img
  if (!img) return
  for (const slug of img.tags ?? []) {
    const chip = document.createElement('span')
    chip.className = 'lb-tag'
    chip.textContent = labelOf(slug)
    const x = document.createElement('button')
    x.type = 'button'
    x.setAttribute('aria-label', `Remove tag ${labelOf(slug)}`)
    x.title = 'Remove tag'
    x.innerHTML = ICON('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')
    x.onclick = () => editTag('remove', [img.id], slug)
    if (tagConfig.value) chip.append(x)
    el.append(chip)
  }
  if (!tagConfig.value) return
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'lb-tag add'
  add.setAttribute('aria-haspopup', 'dialog')
  add.innerHTML = ICON('<path d="M5 12h14"/><path d="M12 5v14"/>')
  add.append('Tag')
  add.onclick = (e) => openTagPicker([img.id], e)
  el.append(add)
  if (hadFocus) add.focus()
}
watch([images, tagConfig], renderLbTags)

function initLightbox(): void {
  if (lightbox) {
    lightbox.destroy()
    lightbox = null
  }

  lightbox = new PhotoSwipeLightbox({
    pswpModule: () => import('photoswipe'),
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    bgOpacity: 0.95,
    showHideOpacity: true,
    counter: false, // replaced by the filename + counter element below
    arrowPrevSVG: ICON('<path d="m15 18-6-6 6-6"/>'),
    arrowNextSVG: ICON('<path d="m9 18 6-6-6-6"/>'),
    closeSVG: ICON('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    zoomSVG: ICON(
      '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>'
    )
  })

  lightbox.on('uiRegister', () => {
    const ui = lightbox!.pswp!.ui!

    // Filename + "N / total", top left
    ui.registerElement({
      name: 'lb-info',
      order: 5,
      appendTo: 'bar',
      onInit: (el, pswp) => {
        const f = document.createElement('span')
        f.className = 'f'
        const c = document.createElement('span')
        c.className = 'c num'
        el.append(f, c)
        pswp.on('change', () => {
          lastViewedId.value = slideImage(pswp)?.id ?? null
          f.textContent = slideImage(pswp)?.originalFilename || ''
          c.textContent = `${pswp.currIndex + 1} / ${nf(pswp.getNumItems())}`
        })
      }
    })

    // Who picked this photo
    ui.registerElement({
      name: 'lb-picked',
      order: 8,
      appendTo: 'bar',
      onInit: (el, pswp) => {
        el.className += ' status'
        pswp.on('change', () => {
          const by = slideImage(pswp)?.favoritedBy || []
          el.hidden = by.length === 0
          el.innerHTML = ICON(
            '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>'
          )
          el.append(by.join(', '))
        })
      }
    })

    // Tags along the bottom: × removes one, "Tag" opens the picker
    ui.registerElement({
      name: 'lb-tags',
      order: 10,
      appendTo: 'root',
      onInit: (el, pswp) => {
        lbTagsEl = el
        el.setAttribute('role', 'group')
        el.setAttribute('aria-label', 'Tags')
        pswp.on('change', renderLbTags)
      }
    })

    // Faces: boxes over the people found in this photo
    ui.registerElement({
      name: 'faces-button',
      order: 8.5,
      isButton: true,
      tagName: 'button',
      title: 'Faces',
      ariaLabel: 'Faces',
      html: ICON(
        '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>'
      ),
      onInit: (el, pswp) => {
        lbFacesBtn = el
        pswp.on('change', renderLbFaces)
        pswp.on('imageSizeChange', ({ slide, width, height }) => {
          const layer = slide.container.querySelector<HTMLElement>('.lb-faces')
          if (layer) Object.assign(layer.style, { width: `${width}px`, height: `${height}px` })
        })
      },
      onClick: () => {
        faceMode.value = !faceMode.value
        renderLbFaces()
      }
    })

    // The note, in words, before who picked it
    ui.registerElement({
      name: 'lb-note',
      order: 7.9,
      appendTo: 'bar',
      tagName: 'button',
      onInit: (el, pswp) => {
        lbNoteEl = el
        el.setAttribute('type', 'button')
        el.className += ' status'
        // Opens on the tab the label names: your note if it shows yours, else the client's
        el.onclick = () => {
          const image = slideImage(pswp)
          if (image)
            openNotesSidebar(image, privateNotes.value[image.id]?.trim() ? 'mine' : 'client')
        }
        pswp.on('change', renderLbNote)
      }
    })

    // Notes button opens the notes panel
    ui.registerElement({
      name: 'notes-button',
      order: 9,
      isButton: true,
      tagName: 'button',
      title: 'Notes',
      ariaLabel: 'Notes',
      html: ICON('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
      onClick: (_event, _el, pswp) => {
        const image = slideImage(pswp)
        if (image) openNotesSidebar(image)
      }
    })
  })

  // Zoom from the tile while it's mounted; null falls back to a fade
  lightbox.addFilter('thumbEl', (_el, _data, index) => {
    const at = lbFromGrid ? index : grid.value.tiles.findIndex((t) => t.image.id === lbItems[0]?.id)
    return document.querySelector(`#gallery [data-pswp-index="${at}"] img`) as HTMLElement // null falls back to a fade
  })

  // Keep the current slide's row rendered so closing animates back to it
  const scrollToCurrent = (): void => {
    const index = lightbox?.pswp?.currIndex
    if (!lbFromGrid || index === undefined) return
    const row = grid.value.tileRow[index]
    if (row !== undefined) rowVirtualizer.value.scrollToIndex(row)
  }
  lightbox.on('change', scrollToCurrent)
  lightbox.on('close', scrollToCurrent)
  lightbox.on('afterInit', () => {
    lbRoot.value = lightbox?.pswp?.element ?? null
  })
  // Typing in a field, or keys in the notes panel (its tabs), must not move, zoom or close the lightbox
  lightbox.on('keydown', (e) => {
    const t = e.originalEvent.target as HTMLElement | null
    if (t?.closest?.('input, textarea, [contenteditable], .notes')) e.preventDefault()
  })
  lightbox.on('destroy', () => {
    if (lbRoot.value) closePop()
    lbRoot.value = null
    lbTagsEl = null
    lbFacesBtn = null
    lbNoteEl = null
  })

  lightbox.init()
}

function showTip(e: Event, names: string[]): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tip.value = {
    left: Math.max(8, Math.min(r.right - 150, innerWidth - 216)),
    top: r.bottom + 6,
    names
  }
}

// Capture phase, ahead of PhotoSwipe's own keys: while the notes panel is open,
// Esc closes the panel only and the lightbox underneath doesn't move
function onKeydown(e: KeyboardEvent): void {
  // A popover over the lightbox keeps the keys (typing, Esc) from moving or closing it
  if (pop.value && lbRoot.value) {
    e.stopImmediatePropagation()
    if (e.key === 'Escape') closePop(true)
    return
  }
  // D: done / not done for the photo shown (not while typing a note)
  const t = e.target as HTMLElement
  if (
    e.key.toLowerCase() === 'd' &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !t.closest?.('input, textarea, [contenteditable]')
  ) {
    const pswp = lightbox?.pswp
    const img = showNotesSidebar.value
      ? currentNotesImage.value
      : lbRoot.value && pswp
        ? slideImage(pswp)
        : null
    if (img && stateOf(img)) {
      e.stopImmediatePropagation()
      e.preventDefault()
      void toggleDone(images.value.find((i) => i.id === img.id) ?? img)
      return
    }
  }
  if (!showNotesSidebar.value) return
  if (!['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'z'].includes(e.key)) return
  // Keys inside the panel are its own (tabs, the caret); the lightbox filter below holds them
  if (e.key !== 'Escape' && t.closest?.('.notes')) return
  e.stopImmediatePropagation()
  if (e.key === 'Escape') closeNotesSidebar()
}

const onAlbumStatusChanged = (_e: unknown, data: { albumId: string; needsSync: number }): void => {
  if (data.albumId === albumId && data.needsSync) {
    window.api.albums.get(albumId).then((result) => {
      if (result.success) album.value = result.album
    })
  }
}

onMounted(() => {
  loadAlbumImages()
  initLightbox()
  window.addEventListener('keydown', onKeydown, true)
  if (window.api && window.api.on) window.api.on('album:status-changed', onAlbumStatusChanged)
  offAnalyzed = window.api.albums.onAnalyzed((id) => {
    if (id === albumId && !loading.value) refreshGrouping()
  })
  loadSets()
  loadTagConfig()
  loadPeople()
  offPeopleChanged = peopleApi?.onPeopleChanged((id) => {
    if (id !== albumId) return
    afterPeopleEdit()
    if (!loading.value) refreshGrouping()
  })
  offSetsChanged = window.api.sets.onSetsChanged((id) => {
    if (id === albumId) loadSets()
  })
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onDocKey)
  document.addEventListener('wheel', onDocScroll, { capture: true, passive: true })
  document.addEventListener('touchmove', onDocScroll, { capture: true, passive: true })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (window.api && window.api.off) window.api.off('album:status-changed', onAlbumStatusChanged)
  resizeObserver.disconnect()
  bannerObserver.disconnect()
  offAnalyzed?.()
  offSetsChanged?.()
  offPeopleChanged?.()
  if (peoplePoll) clearInterval(peoplePoll)
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onDocKey)
  document.removeEventListener('wheel', onDocScroll, true)
  document.removeEventListener('touchmove', onDocScroll, true)
  if (lightbox) {
    lightbox.destroy()
    lightbox = null
  }
})
</script>

<template>
  <AppLayout>
    <!-- Loading -->
    <div v-if="loading" class="gallery">
      <div class="g-side">
        <div class="card">
          <div class="skel" style="height: 12px; width: 40%; border-radius: 6px"></div>
          <div
            class="skel"
            style="height: 28px; width: 80%; border-radius: 8px; margin: 16px 0"
          ></div>
          <div class="skel" style="height: 36px; border-radius: 99px"></div>
        </div>
      </div>
      <div class="g-main">
        <div class="photos" aria-busy="true">
          <div v-for="i in 18" :key="i" class="ph skel"></div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="page">
      <div style="padding: 16px 8px 0">
        <RouterLink class="back" to="/albums"><ArrowLeft />Albums</RouterLink>
      </div>
      <div class="card empty">
        <h2>Couldn't load {{ album?.title || 'this album' }}</h2>
        <p>{{ error }} The photos on this computer are fine.</p>
        <button class="btn primary" @click="loadAlbumImages"><RotateCw />Try again</button>
      </div>
    </div>

    <div v-else class="gallery">
      <div class="g-side">
        <div class="card">
          <RouterLink class="back" to="/albums"><ArrowLeft />Albums</RouterLink>
          <div class="label">
            <span>Album</span>
            <span class="status"
              ><span class="dot" :class="statusLine.dot"></span>{{ statusLine.text }}</span
            >
          </div>
          <h1>{{ album?.title || 'Album' }}</h1>
          <div style="color: var(--ink-3); font-size: 14px" class="num">
            <template v-if="formattedEventDate">{{ formattedEventDate }} · </template
            >{{ nf(images.length) }} photos
          </div>
          <div style="display: flex; gap: 8px; margin-top: 20px">
            <button
              class="btn primary"
              style="flex: 1"
              :disabled="!networkStore.isOnline || isGeneratingLink"
              :aria-busy="isGeneratingLink"
              @click="generateShareLink"
            >
              <span v-if="isGeneratingLink" class="spin"></span><Link />Share with client
            </button>
            <button
              class="icon-btn"
              aria-label="Reload photos"
              title="Reload photos"
              :aria-busy="reloading"
              :disabled="reloading"
              @click="reloadPhotos"
            >
              <RefreshCw />
            </button>
          </div>
        </div>

        <div class="card" :style="clientNames.length ? 'padding-bottom:8px' : ''">
          <div class="seg" role="group" aria-label="Show" style="width: 100%">
            <button style="flex: 1" :aria-pressed="!showFavoritesOnly" @click="viewAll">
              All <span class="n num">{{ nf(images.length) }}</span>
            </button>
            <button style="flex: 1" :aria-pressed="showFavoritesOnly" @click="viewFav">
              <Heart style="width: 16px; height: 16px" />Picks
              <span
                v-if="isLoadingFavorites && !isFavoritesLoaded"
                class="spin"
                style="width: 12px; height: 12px"
              ></span>
              <span v-else class="n num">{{ nf(favoritedPhotosCount) }}</span>
            </button>
          </div>
          <template v-if="clientNames.length">
            <div style="margin: 16px 0 8px; font-size: 13px; color: var(--ink-3)">Picked by</div>
            <div class="people">
              <div v-for="name in clientNames" :key="name" class="person-row">
                <button
                  class="person"
                  :aria-pressed="selectedClientName === name"
                  @click="pickClient(name)"
                >
                  <span
                    v-if="linkedPerson(name)"
                    class="avatar face"
                    :style="faceStyle(linkedPerson(name))"
                    :title="`${name} is ${personName(linkedPerson(name))}`"
                  ></span>
                  <span v-else class="avatar">{{ initials(name) }}</span
                  >{{ name }}
                  <span class="n num">{{ nf(clientCounts[name] || 0) }}</span>
                </button>
                <button
                  v-if="peopleCfg?.enabled && people.length"
                  class="icon-btn sm plain link-face"
                  :class="{ on: !!linkedPerson(name) }"
                  aria-haspopup="menu"
                  :aria-expanded="pop?.kind === 'link' && pop.client === name"
                  :aria-label="`Which person is ${name}?`"
                  :title="`Which person is ${name}?`"
                  @click="openPop({ kind: 'link', client: name }, $event)"
                >
                  <UserRound />
                </button>
              </div>
            </div>
          </template>
        </div>

        <div v-if="peopleCfg" class="card faces-card">
          <div class="faces-h">
            <span>People</span>
            <button
              v-if="peopleCfg.enabled"
              class="icon-btn sm plain"
              aria-label="People options"
              title="People options"
              aria-haspopup="menu"
              :aria-expanded="pop?.kind === 'people'"
              @click="openPop({ kind: 'people' }, $event)"
            >
              <MoreHorizontal />
            </button>
          </div>

          <template v-if="!peopleCfg.enabled">
            <p class="faces-note">See the photos each person is in.</p>
            <button class="btn sm ghost" aria-haspopup="dialog" @click="showPeopleOn = true">
              <ScanFace />Find people…
            </button>
          </template>

          <template v-else>
            <div v-if="peopleCfg.state !== 'done'" class="faces-progress">
              <div
                class="bar"
                :class="{ paused: peopleCfg.state === 'paused' }"
                role="progressbar"
                aria-valuemin="0"
                :aria-valuemax="peopleCfg.total || undefined"
                :aria-valuenow="peopleCfg.processed"
                aria-label="Finding faces"
              >
                <span
                  :style="{ '--p': peopleCfg.total ? peopleCfg.processed / peopleCfg.total : 0 }"
                ></span>
              </div>
              <p class="faces-note num" aria-live="polite">
                <template v-if="peopleCfg.state === 'paused'">
                  Paused until your Mac is plugged in or cooler. It goes on by itself.
                </template>
                <template v-else-if="peopleCfg.state === 'waiting'">
                  Starts when the photos are in.
                </template>
                <template v-else>
                  Finding faces · {{ nf(peopleCfg.processed) }} of {{ photos(peopleCfg.total) }}
                </template>
              </p>
              <p v-if="peopleCfg.onBattery" class="faces-note">On battery. It pauses below 40%.</p>
            </div>

            <button
              v-if="!people.length"
              class="btn sm ghost pick-start"
              aria-haspopup="dialog"
              @click="showPick = true"
            >
              <ScanFace />Pick people from a photo
            </button>

            <div v-else class="faces" role="group" aria-label="People">
              <button
                v-for="p in people"
                :key="p.id"
                class="face-btn"
                :aria-pressed="activePeople.includes(p.id)"
                :title="`${p.name} · ${photos(p.photoCount)}${p.hidden ? ' · hidden from your client' : ''}`"
                :aria-label="`${p.name}, ${photos(p.photoCount)}`"
                @click="togglePerson(p.id)"
                @contextmenu.prevent="openPop({ kind: 'person', person: p }, $event)"
              >
                <span class="avatar face" :style="faceStyle(p)"></span>
                <span class="face-n"><EyeOff v-if="p.hidden" />{{ p.name }}</span>
              </button>
              <button
                class="face-btn face-add"
                aria-haspopup="dialog"
                aria-label="Add people from a photo"
                title="Add people from a photo"
                @click="showPick = true"
              >
                <span class="avatar"><Plus /></span>
                <span class="face-n">Add</span>
              </button>
            </div>

            <!-- Faces the app is not sure about: work that can wait, so a quiet line, not a badge -->
            <div v-if="toCheck.length" class="faces-check">
              <span>To check</span>
              <button
                v-for="p in toCheck"
                :key="p.id"
                class="link num"
                aria-haspopup="dialog"
                :aria-label="`Check ${nf(p.reviewCount)} faces of ${p.name}`"
                @click="reviewing = p"
              >
                {{ p.name }} {{ nf(p.reviewCount) }}
              </button>
            </div>

            <!-- The person whose photos are shown: check their faces and change them here -->
            <div v-if="focusPerson" class="face-focus">
              <span class="t">{{ focusPerson.name }}</span>
              <span class="n num">{{ photos(focusPerson.photoCount) }}</span>
              <button
                v-if="focusPerson.reviewCount"
                class="btn sm ghost"
                aria-haspopup="dialog"
                @click="reviewing = focusPerson"
              >
                Check {{ nf(focusPerson.reviewCount) }}
              </button>
              <button
                class="icon-btn sm plain"
                aria-haspopup="menu"
                :aria-expanded="pop?.kind === 'person'"
                :aria-label="`Options for ${focusPerson.name}`"
                :title="`Options for ${focusPerson.name}`"
                @click="openPop({ kind: 'person', person: focusPerson }, $event)"
              >
                <MoreHorizontal />
              </button>
            </div>
          </template>
        </div>

        <!-- Notes: the photographer's own, and the photos whose notes are still to do. One quiet
             line until there is something in it. -->
        <div v-if="notesError" class="card notes-card quiet" role="status">
          <span class="notes-line bad">Couldn't load your notes.</span>
          <button class="link" @click="retryNotes">Try again</button>
        </div>
        <div v-else-if="!notesLoaded" class="card notes-card quiet" aria-busy="true">
          <span class="notes-line"><span class="spin"></span>Notes</span>
        </div>
        <div v-else-if="!hasNotes" class="card notes-card quiet">
          <button class="link notes-add" @click="showAlbumNote = true">
            <NotebookPen />Add a note for yourself
          </button>
        </div>
        <div v-else class="card notes-card">
          <div class="faces-h">Notes</div>
          <!-- Photos with a note, yours or the client's: still to do, or done -->
          <div v-if="noteCounts.open || noteCounts.done || noteFilter" class="people note-rows">
            <div
              v-for="r in noteRows"
              :key="r.state"
              class="person-row"
              :class="{ on: noteFilter === r.state }"
            >
              <button
                class="person"
                :aria-pressed="noteFilter === r.state"
                :title="r.title"
                @click="noteFilter = noteFilter === r.state ? null : r.state"
              >
                <span class="avatar"><component :is="r.icon" /></span>{{ r.label }}
                <span class="n num">{{ nf(noteCounts[r.state]) }}</span>
              </button>
              <button
                v-if="noteFilter === r.state"
                class="icon-btn sm plain link-face"
                :aria-label="`Show all photos, not only ${r.label.toLowerCase()}`"
                title="Show all"
                @click="noteFilter = null"
              >
                <X />
              </button>
            </div>
          </div>
          <PrivateNote
            v-if="albumNote || showAlbumNote"
            class="album-note"
            :value="albumNote"
            label="On this album"
            placeholder="Venue, the couple's wishes, what's left to edit…"
            :autofocus="showAlbumNote && !albumNote"
            :save="saveAlbumNote"
          />
          <button v-else class="link notes-add" @click="showAlbumNote = true">
            <NotebookPen />Add a note for yourself
          </button>
        </div>
      </div>

      <section class="g-main" aria-label="Photos" :style="{ '--head-h': `${headH}px` }">
        <!-- The title scrolls away; the pressed set and tags still say what is shown -->
        <div v-if="!isSelectionMode" class="g-bar">
          <span class="t">{{ barTitle }}</span>
          <span class="m num">{{ nf(filteredImages.length) }}</span>
          <!-- The notes filter, said where the photos are, and undone in one click -->
          <button
            v-if="noteFilter"
            class="btn sm ghost f-on"
            :aria-label="`Notes ${noteFilter === 'open' ? 'to do' : 'done'}: show all photos`"
            @click="noteFilter = null"
          >
            <component :is="noteFilter === 'open' ? NotebookPen : Check" />Notes
            {{ noteFilter === 'open' ? 'to do' : 'done' }}<X class="x" />
          </button>
          <span class="g-bar-r">
            <button
              v-if="hasBursts"
              class="btn sm ghost stack-toggle"
              :aria-pressed="stackBursts"
              @click="stackBursts = !stackBursts"
            >
              <Layers />Stack bursts
            </button>
          </span>
        </div>
        <div ref="headEl" class="g-head">
          <div class="g-head-in">
            <div v-if="isSelectionMode" class="g-bar sel" role="toolbar" aria-label="Selection">
              <button class="icon-btn sm" aria-label="Clear selection" @click="clearSelection">
                <X />
              </button>
              <span class="t num">{{ nf(selectedImageIds.size) }} selected</span>
              <button class="btn sm ghost" style="margin-left: auto" @click="selectAll">
                Select all {{ nf(filteredImages.length) }}
              </button>
              <button
                v-if="selectedOpen.length"
                class="btn sm ghost"
                :disabled="lockedFor('done-bulk')"
                :aria-busy="pending === 'done-bulk'"
                @click="markSelectedDone"
              >
                <span v-if="pending === 'done-bulk'" class="spin"></span><Check />Mark
                {{ nf(selectedOpen.length) }} done
              </button>
              <template v-if="activeSet">
                <button
                  v-if="selectedImageIds.size === 1"
                  class="btn sm ghost"
                  :disabled="!!pending"
                  :aria-busy="pending === 'set-cover'"
                  @click="useAsCover"
                >
                  <span v-if="pending === 'set-cover'" class="spin"></span><ImageIcon />Use as cover
                </button>
                <button
                  class="btn sm ghost"
                  :disabled="!!pending"
                  :aria-busy="pending === 'set-remove'"
                  @click="removeSelectedFromSet"
                >
                  <span v-if="pending === 'set-remove'" class="spin"></span><Minus />Remove from set
                </button>
              </template>
              <button
                class="btn sm ghost"
                aria-haspopup="menu"
                :aria-expanded="pop?.kind === 'add'"
                @click="openPop({ kind: 'add' }, $event)"
              >
                <Plus />Add to set…
              </button>
              <button
                v-if="tagConfig"
                class="btn sm ghost"
                aria-haspopup="dialog"
                :aria-expanded="pop?.kind === 'tags'"
                @click="openTagPicker(selectedIds(), $event)"
              >
                <Tag />Tags…
              </button>
              <button
                class="btn sm primary"
                :disabled="copying"
                :aria-busy="copying"
                @click="copySelectedImages"
              >
                <span v-if="copying" class="spin"></span><Copy />Copy
                {{ nf(selectedImageIds.size) }} to folder…
              </button>
            </div>

            <div v-if="images.length" class="set-bar" role="toolbar" aria-label="Sets">
              <button class="btn sm ghost" :aria-pressed="!activeSet" @click="viewSet(null)">
                All photos <span class="n num">{{ nf(images.length) }}</span>
              </button>
              <template v-for="s in sets" :key="s.id">
                <button
                  class="btn sm ghost"
                  :aria-pressed="activeSetId === s.id"
                  @click="viewSet(s.id)"
                  @contextmenu.prevent="openPop({ kind: 'set', set: s }, $event)"
                >
                  <!-- Folders, so sets read as places photos live in, not labels like tags -->
                  <component :is="activeSetId === s.id ? FolderOpen : Folder" class="set-ic" />
                  {{ s.name }} <span class="n num">{{ nf(s.imageIds.length) }}</span>
                </button>
                <button
                  v-if="activeSetId === s.id"
                  class="icon-btn sm plain"
                  aria-haspopup="menu"
                  :aria-expanded="pop?.kind === 'set'"
                  :aria-label="`Options for ${s.name}`"
                  :title="`Options for ${s.name}`"
                  @click="openPop({ kind: 'set', set: s }, $event)"
                >
                  <MoreHorizontal />
                </button>
              </template>
              <button class="btn sm ghost" aria-haspopup="dialog" @click="newSet">
                <FolderPlus />New set
              </button>
            </div>

            <div v-if="hasTags" class="set-bar" role="toolbar" aria-label="Tags">
              <!-- Stays put while the chips scroll under it -->
              <div class="tag-lead">
                <input
                  v-model="tagQuery"
                  class="input tag-search"
                  type="search"
                  placeholder="Find a tag"
                  aria-label="Find a tag"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button
                  v-if="tagConfig"
                  class="icon-btn sm plain"
                  aria-haspopup="dialog"
                  aria-label="Album tags…"
                  title="Album tags…"
                  @click="openTagSet"
                >
                  <SlidersHorizontal />
                </button>
                <button
                  v-if="activeTags.length || tagQuery"
                  class="icon-btn sm plain"
                  aria-label="Clear tag filters"
                  title="Clear tag filters"
                  @click="clearTags"
                >
                  <X />
                </button>
              </div>
              <button
                v-for="[slug, n] in tagChips"
                :key="slug"
                class="btn sm ghost"
                :aria-pressed="activeTags.includes(slug)"
                @click="toggleTag(slug)"
              >
                {{ labelOf(slug) }} <span class="n num">{{ nf(n) }}</span>
              </button>
              <span v-if="tagQuery && !tagChips.length" class="n">No tags match</span>
            </div>
          </div>
        </div>

        <div v-if="gridLoading" class="photos" aria-busy="true">
          <div v-for="i in 18" :key="i" class="ph skel"></div>
        </div>

        <div v-else-if="images.length === 0" class="empty">
          <h2>No photos in this album</h2>
          <p>
            Drop photos into <b>{{ album?.sourceFolderPath || 'its folder' }}</b
            >. They upload on their own.
          </p>
          <button v-if="album?.sourceFolderPath" class="btn ghost" @click="showAlbumFolder">
            <FolderOpen />Show in Finder
          </button>
        </div>

        <div v-else-if="filteredImages.length === 0 && noteFilter === 'open'" class="empty">
          <h2>Nothing left to do here</h2>
          <p>Every note in this view is marked done.</p>
          <button class="btn ghost" @click="noteFilter = null">Show all</button>
        </div>

        <div v-else-if="filteredImages.length === 0 && noteFilter === 'done'" class="empty">
          <h2>Nothing marked done here</h2>
          <p>Open a photo's notes and press Mark done, or press D in the photo view.</p>
          <button class="btn ghost" @click="noteFilter = null">Show all</button>
        </div>

        <div v-else-if="filteredImages.length === 0 && activeTags.length" class="empty">
          <h2>No photos tagged {{ activeTags.map(tagLabel).join(' + ') }}</h2>
          <p>Try fewer tags{{ activeSet || showFavoritesOnly ? ', or a wider view' : '' }}.</p>
          <button class="btn ghost" @click="clearTags">Clear tags</button>
        </div>

        <div v-else-if="filteredImages.length === 0 && activePeople.length" class="empty">
          <h2>No photos with {{ peopleNames(activePeople) }}</h2>
          <p>Try fewer people{{ activeSet || showFavoritesOnly ? ', or a wider view' : '' }}.</p>
          <button class="btn ghost" @click="activePeople = []">Show everyone</button>
        </div>

        <div
          v-else-if="filteredImages.length === 0 && activeSet && !showFavoritesOnly"
          class="empty"
        >
          <h2>“{{ activeSet.name }}” is empty</h2>
          <p>Select photos in All photos, then choose Add to set.</p>
          <button class="btn ghost" @click="viewSet(null)">View all photos</button>
        </div>

        <div v-else-if="filteredImages.length === 0" class="empty">
          <h2>No picks yet</h2>
          <p>When your client hearts a photo on their link, it shows up here</p>
          <button class="btn ghost" @click="viewAll">View all photos</button>
        </div>

        <template v-else>
          <div class="g-browse">
            <div id="gallery" ref="galleryEl" :class="{ selecting: isSelectionMode }">
              <div
                style="position: relative"
                :style="{ height: `${rowVirtualizer.getTotalSize()}px` }"
              >
                <template v-for="{ v, row, sticky } in virtualRows" :key="v.key">
                  <div
                    v-if="row.kind === 'header'"
                    class="g-moment"
                    :class="{ sticky }"
                    :style="
                      sticky ? undefined : { transform: `translateY(${v.start - scrollMargin}px)` }
                    "
                  >
                    <span class="g-moment-t">{{ row.label }}</span>
                    <button
                      v-if="row.momentId != null && !activeSet && !showFavoritesOnly"
                      class="btn sm ghost g-make-set"
                      aria-haspopup="dialog"
                      @click="makeSetFromMoment(row, $event)"
                    >
                      <Plus />Make set
                    </button>
                  </div>
                  <div
                    v-else
                    class="photos g-row"
                    :style="{
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                      transform: `translateY(${v.start - scrollMargin}px)`
                    }"
                  >
                    <PhotoTile
                      v-for="tile in row.tiles"
                      :key="tile.image.id"
                      :image="tile.image"
                      :burst="tile.burst"
                      :index="tile.index"
                      :status="getDisplayStatus(tile.image.uploadStatus)"
                      :thumb="`file://${getThumbnailPath(tile.image.localFilePath)}`"
                      :selected="isTileSelected(tile)"
                      :my-note="privateNotes[tile.image.id]"
                      :note-state="stateOf(tile.image)"
                      @open="handleImageClick($event, tile)"
                      @toggle="toggleTile(tile)"
                      @tip="showTip"
                      @untip="tip = null"
                      @notes="(tab) => openNotesSidebar(tile.image, tab)"
                      @reveal="showOriginalInFolder(tile.image)"
                    />
                  </div>
                </template>
              </div>
            </div>
            <nav v-if="grid.headers.length > 1" class="g-scrub" aria-label="Moments">
              <button
                v-for="h in grid.headers"
                :key="h.row"
                :aria-label="h.label"
                :title="h.label"
                :aria-current="h.row === currentHeader || undefined"
                @click="scrollToMoment(h.row)"
              >
                {{ h.label.split(' · ')[1] }}
              </button>
            </nav>
          </div>
        </template>
      </section>
    </div>

    <Teleport to="body">
      <div v-if="tip" class="tip" :style="{ left: `${tip.left}px`, top: `${tip.top}px` }">
        <b>Picked by</b>
        <template v-for="(n, i) in tip.names" :key="n"><br v-if="i" />{{ n }}</template>
      </div>
    </Teleport>

    <Teleport :to="lbRoot ?? 'body'">
      <div
        v-if="pop"
        ref="popEl"
        class="menu"
        :class="{ 'tag-pick': pop.kind === 'tags', 'pick-people': pop.kind === 'merge' }"
        :role="pop.kind === 'name' || pop.kind === 'tags' ? 'dialog' : 'menu'"
        :aria-label="
          pop.kind === 'name'
            ? pop.label
            : pop.kind === 'tags'
              ? `Tags for ${photos(pop.ids.length)}`
              : undefined
        "
        :style="popStyle"
      >
        <template v-if="pop.kind === 'tags'">
          <form class="pick-find" @submit.prevent="pickCustom && pickAdd(pickCustom)">
            <input
              v-model="pop.query"
              class="input"
              type="search"
              placeholder="Find or add a tag"
              aria-label="Find or add a tag"
              autocomplete="off"
              spellcheck="false"
            />
          </form>
          <div class="pick-list" :aria-busy="pending === 'tags'">
            <template v-if="pickPresent.length">
              <div class="pick-h">
                {{ pop.ids.length === 1 ? 'On this photo' : 'On the selection' }}
              </div>
              <div v-for="[slug, n] in pickPresent" :key="slug" class="pick-row">
                <button
                  v-if="pop.ids.length > 1"
                  :disabled="n === pop.ids.length || !!pending"
                  :aria-label="`Add ${labelOf(slug)} to all ${photos(pop.ids.length)}`"
                  @click="pickAdd(slug)"
                >
                  {{ labelOf(slug)
                  }}<span class="n num">{{ nf(n) }} of {{ nf(pop.ids.length) }}</span>
                </button>
                <span v-else class="pick-t">{{ labelOf(slug) }}</span>
                <button
                  class="icon-btn sm plain"
                  :disabled="!!pending"
                  :aria-label="
                    `Remove ${labelOf(slug)}` + (pop.ids.length > 1 ? ` from ${photos(n)}` : '')
                  "
                  :title="pop.ids.length > 1 ? `Remove from ${photos(n)}` : 'Remove'"
                  @click="pickRemove(slug)"
                >
                  <X />
                </button>
              </div>
              <hr />
            </template>
            <template v-for="g in pickGroups" :key="g.category">
              <div class="pick-h">{{ g.label }}</div>
              <button
                v-for="t in g.tags"
                :key="t.slug"
                :disabled="!!pending"
                @click="pickAdd(t.slug)"
              >
                {{ t.label }}
              </button>
            </template>
            <button v-if="pickCustom" :disabled="!!pending" @click="pickAdd(pickCustom)">
              <Plus />Add “{{ tagLabel(pickCustom) }}”
            </button>
            <p v-if="!pickGroups.length && !pickCustom && !pickPresent.length" class="pick-h">
              Type a name to add your own tag
            </p>
          </div>
        </template>
        <form v-else-if="pop.kind === 'name'" class="set-name" @submit.prevent="submitName">
          <label for="set-name-in">{{ pop.label }}</label>
          <div class="input-row">
            <input
              id="set-name-in"
              v-model="pop.name"
              class="input"
              maxlength="120"
              autocomplete="off"
              :placeholder="pop.placeholder ?? 'Set name'"
            />
            <button
              class="btn primary"
              :disabled="!pop.name.trim() || !!pending"
              :aria-busy="pending === 'name'"
            >
              <span v-if="pending === 'name'" class="spin"></span>Save
            </button>
          </div>
        </form>
        <template v-else-if="pop.kind === 'person'">
          <button
            v-if="pop.person.reviewCount"
            role="menuitem"
            @click="((reviewing = pop.person), closePop())"
          >
            <ScanFace />Check {{ nf(pop.person.reviewCount) }} faces…
          </button>
          <button role="menuitem" @click="renamePerson(pop.person)"><Pencil />Rename…</button>
          <button
            v-if="people.length > 1"
            role="menuitem"
            @click="openPop({ kind: 'merge', person: pop.person })"
          >
            <UserRound />Merge with…
          </button>
          <button role="menuitem" @click="hidePerson(pop.person, !pop.person.hidden)">
            <EyeOff />{{
              pop.person.hidden ? 'Show in client gallery' : 'Hide from client gallery'
            }}
          </button>
          <hr />
          <button role="menuitem" class="bad" @click="((personToRemove = pop.person), closePop())">
            <Trash2 />Remove person…
          </button>
        </template>
        <template v-else-if="pop.kind === 'merge'">
          <div class="pick-h">Merge {{ pop.person.name }} with</div>
          <button
            v-for="p in mergeTargets"
            :key="p.id"
            role="menuitem"
            @click="((mergeAsk = { from: pop.person, into: p }), closePop())"
          >
            <span class="avatar face xs" :style="faceStyle(p)"></span>{{ p.name
            }}<span class="n num">{{ nf(p.photoCount) }}</span>
          </button>
        </template>
        <template v-else-if="pop.kind === 'face'">
          <div class="pick-h">Who is this?</div>
          <button
            v-for="p in people"
            :key="p.id"
            role="menuitem"
            :aria-current="pop.face.personId === p.id || undefined"
            v-bind="menuBusy(`face:${p.id}`)"
            @click="popRun(`face:${p.id}`, () => assignFace({ personId: p.id }))"
          >
            <span class="avatar face xs" :style="faceStyle(p)"></span>{{ p.name }}
            <span v-if="pending === `face:${p.id}`" class="spin"></span>
            <Check v-else-if="pop.face.personId === p.id" class="cur" />
          </button>
          <button role="menuitem" v-bind="menuBusy('new')" @click="!pending && newPersonForFace()">
            <Plus />New person…
          </button>
          <template v-if="pop.face.personId">
            <hr />
            <button
              v-if="pop.face.name"
              role="menuitem"
              v-bind="menuBusy('cover')"
              @click="useFaceAsCover"
            >
              <ImageIcon />Use this face for {{ pop.face.name }}
              <span v-if="pending === 'cover'" class="spin"></span>
            </button>
            <button
              role="menuitem"
              class="bad"
              v-bind="menuBusy('face:none')"
              @click="popRun('face:none', () => assignFace({ none: true }))"
            >
              <X />Not {{ pop.face.name || 'this person' }}
              <span v-if="pending === 'face:none'" class="spin"></span>
            </button>
          </template>
        </template>
        <template v-else-if="pop.kind === 'link'">
          <div class="pick-h">Which person is {{ firstName(pop.client) }}?</div>
          <button
            v-for="p in people"
            :key="p.id"
            role="menuitem"
            v-bind="menuBusy(`link:${p.id}`)"
            @click="linkClient(pop.client, p.id)"
          >
            <span class="avatar face xs" :style="faceStyle(p)"></span>{{ p.name }}
            <span v-if="pending === `link:${p.id}`" class="spin"></span>
            <Check v-else-if="clientLinks[pop.client] === p.id" class="cur" />
          </button>
          <template v-if="clientLinks[pop.client]">
            <hr />
            <button
              role="menuitem"
              v-bind="menuBusy('link:null')"
              @click="linkClient(pop.client, null)"
            >
              <X />Not in the photos
              <span v-if="pending === 'link:null'" class="spin"></span>
            </button>
          </template>
        </template>
        <template v-else-if="pop.kind === 'people'">
          <button role="menuitem" class="bad" @click="(closePop(), (showPeopleOff = true))">
            <Trash2 />Turn off People…
          </button>
        </template>
        <template v-else-if="pop.kind === 'add'">
          <button
            v-for="s in sets"
            :key="s.id"
            role="menuitem"
            v-bind="menuBusy(`add:${s.id}`)"
            @click="addSelectedTo(s)"
          >
            <Folder class="set-ic" />{{ s.name
            }}<span v-if="pending === `add:${s.id}`" class="spin"></span
            ><span v-else class="n num">{{ nf(s.imageIds.length) }}</span>
          </button>
          <hr v-if="sets.length" />
          <button
            role="menuitem"
            v-bind="menuBusy('new')"
            @click="!pending && newSetFromSelection()"
          >
            <Plus />New set…
          </button>
        </template>
        <template v-else>
          <button role="menuitem" @click="renameSet(pop.set)"><Pencil />Rename…</button>
          <button
            role="menuitem"
            :disabled="sets[0]?.id === pop.set.id"
            @click="moveSet(pop.set, -1)"
          >
            <ChevronLeft />Move left
          </button>
          <button
            role="menuitem"
            :disabled="sets[sets.length - 1]?.id === pop.set.id"
            @click="moveSet(pop.set, 1)"
          >
            <ChevronRight />Move right
          </button>
          <hr />
          <button role="menuitem" class="bad" @click="askDeleteSet(pop.set)">
            <Trash2 />Delete set…
          </button>
        </template>
      </div>
    </Teleport>

    <Modal
      :show="!!setToDelete"
      :title="`Delete “${setToDelete?.name || ''}”?`"
      @close="!deletingSet && (setToDelete = null)"
    >
      <p>
        The {{ photos(setToDelete?.imageIds.length || 0) }} stay in the album. Only the set goes
        away, here and on your client's link.
      </p>
      <template #footer>
        <button class="btn ghost" :disabled="deletingSet" @click="setToDelete = null">
          Cancel
        </button>
        <button
          class="btn danger"
          :disabled="deletingSet"
          :aria-busy="deletingSet"
          autofocus
          @click="confirmDeleteSet"
        >
          <span v-if="deletingSet" class="spin"></span>Delete set
        </button>
      </template>
    </Modal>

    <Modal
      :show="showTagSet"
      title="Album tags"
      sub="What AI looks for in these photos"
      @close="!savingTagSet && (showTagSet = false)"
    >
      <div class="field">
        <label for="tag-event">What kind of event?</label>
        <select id="tag-event" v-model="draftEvent" class="input" autofocus>
          <option v-for="e in tagConfig?.eventTypes" :key="e.id" :value="e.id">
            {{ e.label }}
          </option>
        </select>
        <span class="hint" aria-live="polite">
          <template v-if="eventChanged">
            Suggestions switch to {{ eventLabel(draftEvent).toLowerCase() }} tags when you save.
            Tags you added by hand stay.
          </template>
          <template v-else-if="draftIsPack">Suggesting {{ packSummary }}</template>
          <template v-else>
            Suggesting {{ nf(draftOn.size) }} tags you chose ·
            <button class="link" @click="tagDraft = null">Use the suggested ones</button>
          </template>
        </span>
      </div>
      <details v-if="!eventChanged" class="tag-choose">
        <summary>Choose tags…</summary>
        <div v-if="tagConfig?.eventType === 'wedding'" class="tag-presets">
          <span id="tag-trad">Wedding tradition</span>
          <div role="group" aria-labelledby="tag-trad" class="tag-trad">
            <button
              v-for="p in PRESETS"
              :key="p.name"
              class="btn sm ghost"
              :aria-pressed="isPreset(p.exclude)"
              @click="tagDraft = new Set(presetSlugs(p.exclude, tagConfig.pack))"
            >
              {{ p.name }}
            </button>
          </div>
        </div>
        <div class="tag-cats">
          <fieldset v-for="g in tagSetGroups" :key="g.category">
            <legend>{{ g.label }}</legend>
            <div class="tag-checks">
              <label v-for="t in g.tags" :key="t.slug" class="check-row">
                <input
                  type="checkbox"
                  :checked="draftOn.has(t.slug)"
                  @change="toggleDraft(t.slug)"
                />
                {{ t.label }}
              </label>
            </div>
          </fieldset>
        </div>
      </details>
      <template #footer>
        <button class="btn ghost" :disabled="savingTagSet" @click="showTagSet = false">
          Cancel
        </button>
        <button
          class="btn primary"
          :disabled="savingTagSet"
          :aria-busy="savingTagSet"
          @click="saveTagSet"
        >
          <span v-if="savingTagSet" class="spin"></span>Save
        </button>
      </template>
    </Modal>

    <Modal
      :show="showPeopleOn"
      title="Find people in photos"
      :sub="album?.title"
      @close="!peopleBusy && (showPeopleOn = false)"
    >
      <ul class="consent">
        <li>LumoSnap finds the faces on this computer. No photo is sent anywhere to do it.</li>
        <li>
          Your client's gallery gets only the names you give, each with a small crop of the face.
        </li>
        <li>
          Turn it on only if
          {{ tagConfig?.eventType === 'wedding' ? 'the couple agrees' : 'your client agrees' }}.
        </li>
        <li>Turn it off at any time. That deletes all face data, here and online.</li>
      </ul>
      <template #footer>
        <button class="btn ghost" :disabled="peopleBusy" @click="showPeopleOn = false">
          Cancel
        </button>
        <button
          class="btn primary"
          :disabled="peopleBusy"
          :aria-busy="peopleBusy"
          autofocus
          @click="turnPeopleOn"
        >
          <span v-if="peopleBusy" class="spin"></span>Turn on
        </button>
      </template>
    </Modal>

    <Modal
      :show="showPeopleOff"
      title="Turn off People?"
      @close="!peopleBusy && (showPeopleOff = false)"
    >
      <p>
        This deletes every face and name in this album, on this computer and in your client's
        gallery. The photos stay. Client links to people go too.
      </p>
      <template #footer>
        <button class="btn ghost" :disabled="peopleBusy" autofocus @click="showPeopleOff = false">
          Cancel
        </button>
        <button
          class="btn danger"
          :disabled="peopleBusy"
          :aria-busy="peopleBusy"
          @click="turnPeopleOff"
        >
          <span v-if="peopleBusy" class="spin"></span>Turn off and delete
        </button>
      </template>
    </Modal>

    <Modal
      :show="!!personToRemove"
      :title="`Remove ${personToRemove?.name ?? ''}?`"
      @close="!peopleBusy && (personToRemove = null)"
    >
      <p>
        The photos stay. The name goes, here and in your client's gallery, and
        {{ personToRemove?.name ?? '' }}'s faces are no longer matched.
      </p>
      <template #footer>
        <button class="btn ghost" :disabled="peopleBusy" autofocus @click="personToRemove = null">
          Cancel
        </button>
        <button
          class="btn danger"
          :disabled="peopleBusy"
          :aria-busy="peopleBusy"
          @click="removePerson"
        >
          <span v-if="peopleBusy" class="spin"></span>Remove
        </button>
      </template>
    </Modal>

    <Modal
      :show="!!mergeAsk"
      :title="`Merge ${mergeAsk?.from.name ?? ''} into ${mergeAsk?.into.name ?? ''}?`"
      @close="!peopleBusy && (mergeAsk = null)"
    >
      <p>
        {{ mergeAsk?.from.name }}'s faces become {{ mergeAsk?.into.name }}'s, here and in your
        client's gallery. There is no undo.
      </p>
      <template #footer>
        <button class="btn ghost" :disabled="peopleBusy" autofocus @click="mergeAsk = null">
          Cancel
        </button>
        <button
          class="btn primary"
          :disabled="peopleBusy"
          :aria-busy="peopleBusy"
          @click="confirmMerge"
        >
          <span v-if="peopleBusy" class="spin"></span>Merge
        </button>
      </template>
    </Modal>

    <PeoplePick
      v-if="showPick && peopleApi"
      :album-id="albumId"
      :api="peopleApi"
      :people="people"
      :photo="pickPhoto"
      :face-style="faceStyle"
      :last-viewed-id="lastViewedId"
      :scan="peopleCfg"
      @changed="afterPeopleEdit"
      @close="showPick = false"
    />
    <PeopleReview
      v-if="reviewing && peopleApi"
      :album-id="albumId"
      :api="peopleApi"
      :person="reviewing"
      :aspect="photoAspect"
      :face-style="faceStyle"
      @changed="afterPeopleEdit"
      @close="reviewing = null"
    />

    <NotesSidebar
      :is-open="showNotesSidebar"
      :image="currentNotesImage"
      :note="(currentNotesImage && privateNotes[currentNotesImage.id]) || ''"
      :save-note="saveImageNote"
      :state="currentNotesImage && stateOf(currentNotesImage)"
      :done-at="currentNotesImage ? doneAt[currentNotesImage.id] : undefined"
      :busy="!!currentNotesImage && pending === `done:${currentNotesImage.id}`"
      :locked="!!currentNotesImage && lockedFor(`done:${currentNotesImage.id}`)"
      :open-on="notesTab"
      @toggle-done="currentNotesImage && toggleDone(currentNotesImage)"
      @close="closeNotesSidebar"
    />

    <Modal
      :show="showShareModal"
      title="Client link"
      :sub="album?.title"
      @close="showShareModal = false"
    >
      <p>
        Send this to your client. They can view the photos, heart their picks and leave notes. No
        account needed.
      </p>
      <div class="input-row">
        <input class="input mono" readonly :value="shareLink" aria-label="Client link" />
        <button class="btn primary" @click="copyShareLink">
          <Check v-if="copied" /><Copy v-else />{{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p v-if="showShareNext" style="font-size: 14px">
        <Check style="width: 16px; height: 16px; color: var(--ok); vertical-align: -3px" /> Copied.
        Paste it in WhatsApp or email. Their hearts and notes appear in this album as they pick.
      </p>
      <template #footer>
        <button class="btn ghost" @click="openShareLink"><ExternalLink />Open in browser</button>
        <button class="btn primary" @click="showShareModal = false">Done</button>
      </template>
    </Modal>
  </AppLayout>
</template>

<style scoped>
.g-row,
.g-moment {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
.g-moment {
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 13px;
  color: var(--ink-2);
  background: var(--card);
}
.g-moment-t {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.g-moment.sticky {
  position: sticky;
  top: var(--head-h);
  z-index: 2;
}
/* updateGridLayout keeps the row under the pinned bar itself; the browser's anchoring would add to it */
.g-main {
  overflow-anchor: none;
}
/* Sets, tags and the selection bar: the controls stay in reach in a 10,000-photo album.
   It never changes height on scroll, so nothing under it jumps. */
.g-head {
  position: sticky;
  top: 0;
  z-index: 6; /* over the rows, the moment label and the scrubber */
  background: var(--card);
  container-type: scroll-state;
}
/* Pinned, it also covers the scroller's top padding, so no photo shows above it */
@container scroll-state(stuck: top) {
  .g-head-in {
    box-shadow: 0 -16px 0 var(--card);
  }
}
.stack-toggle[aria-pressed='true'],
.set-bar .btn[aria-pressed='true'] {
  background: var(--brand-wash);
  border-color: var(--brand-soft);
}
.set-ic {
  color: var(--ink-3);
}
[aria-pressed='true'] > .set-ic {
  color: var(--brand);
}
/* One line that scrolls sideways, so the gallery's offset never changes */
.set-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 12px 12px;
  overflow-x: auto;
  scrollbar-width: none;
}
.set-bar > * {
  flex: none;
}
.tag-search {
  width: 160px;
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
}
.tag-lead {
  position: sticky;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 4px;
  background: var(--card);
  box-shadow: -12px 0 0 var(--card); /* covers the bar's left padding as chips scroll by */
}
@media (max-width: 1180px) {
  .tag-search {
    width: 128px;
  }
}
/* Narrow windows: the selection bar scrolls sideways like the set bar */
.g-bar.sel {
  overflow-x: auto;
  scrollbar-width: none;
}
.g-bar.sel > * {
  flex: none;
}
.tag-pick {
  width: 288px;
  padding: 8px 8px 4px;
}
.pick-find input {
  height: 36px;
  font-size: 13px;
}
.pick-list {
  max-height: min(320px, 50vh);
  overflow-y: auto;
  margin-top: 4px;
}
.pick-h {
  margin: 8px 12px 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.pick-row {
  display: flex;
  align-items: center;
}
.pick-row .pick-t {
  flex: 1;
  padding: 0 12px;
}
.pick-row .icon-btn {
  flex: none;
  width: 32px;
  padding: 0;
  justify-content: center;
}
.tag-choose summary {
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--brand);
  font-weight: 500;
  cursor: pointer;
  border-radius: 4px;
}
.tag-choose summary::-webkit-details-marker {
  display: none;
}
.tag-choose summary:hover {
  text-decoration: underline;
}
.tag-choose summary:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
.tag-choose[open] summary {
  margin-bottom: 16px;
}
.tag-presets {
  display: grid;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-2);
  margin-bottom: 16px;
}
.tag-presets [role='group'] {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag-presets .btn[aria-pressed='true'] {
  background: var(--brand-wash);
  border-color: var(--brand-soft);
}
.tag-cats {
  display: grid;
  gap: 16px;
  max-height: 40vh;
  overflow-y: auto;
  margin: 0 -24px;
  padding: 0 24px;
}
.tag-cats fieldset {
  border: 0;
  margin: 0;
  padding: 0;
}
.tag-cats legend {
  font-size: 13px;
  color: var(--ink-2);
  padding: 0;
}
.tag-checks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}
.tag-checks .check-row {
  margin: 0;
  min-height: 32px;
  font-size: 13px;
}
.tag-checks .check-row input {
  width: 18px;
  height: 18px;
}
.set-bar .n,
.menu .n {
  color: var(--ink-3);
  font-size: 12px;
}
.menu .n {
  margin-left: auto;
}
.set-name {
  display: grid;
  gap: 8px;
  width: 272px;
  padding: 4px;
  font-size: 13px;
  color: var(--ink-2);
}
.set-name .btn {
  width: auto;
  flex: none;
  height: 40px;
  padding: 0 16px;
}
.menu button:disabled {
  opacity: 0.4;
  background: none;
}
.g-make-set {
  margin-left: auto;
  height: 28px;
  opacity: 0;
  transition: opacity 0.12s;
}
.g-moment:hover .g-make-set,
.g-make-set:focus-visible {
  opacity: 1;
}
/* The scrubber takes its own column, so the grid's width (and column count) leaves room for it */
.g-browse {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
#gallery {
  flex: 1;
  min-width: 0;
}
.g-scrub {
  position: sticky;
  /* centred in the room under the pinned bar, and never under it */
  top: calc(50vh + var(--head-h) / 2 - 8px);
  transform: translateY(-50%);
  flex: none;
  z-index: 5;
  display: grid;
  gap: 2px;
  max-height: calc(100vh - var(--head-h) - 64px);
  overflow-y: auto;
  padding: 4px;
  background: var(--card);
  border-radius: var(--r-inset);
  box-shadow: var(--lift);
}
.g-scrub button {
  border: 0;
  background: none;
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--ink-3);
  text-align: right;
  white-space: nowrap;
}
.g-scrub button:hover {
  background: var(--inset);
  color: var(--ink);
}
.g-scrub button[aria-current='true'] {
  background: var(--brand-wash);
  color: var(--ink);
}
/* People: the faces card in the side panel, next to Picked by */
.faces-card {
  padding: 16px 24px 24px;
}
.faces-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  margin-right: -8px;
  font-size: 13px;
  color: var(--ink-3);
}
.faces-note {
  margin: 4px 0 12px;
  font-size: 13px;
  color: var(--ink-2);
}
.faces-progress {
  margin-top: 8px;
}
.faces-progress .faces-note {
  margin: 8px 0 0;
  color: var(--ink-3);
}
.bar.paused > span {
  background: var(--line-2);
}
.faces {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px 4px;
  margin-top: 12px;
}
.face-btn {
  display: grid;
  justify-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  border-radius: 99px;
}
.avatar.face {
  background-color: var(--inset-2);
  background-repeat: no-repeat;
}
.faces .avatar {
  width: 44px;
  height: 44px;
  transition: box-shadow 0.12s var(--ease);
}
.face-btn:hover .avatar {
  box-shadow:
    0 0 0 2px var(--card),
    0 0 0 4px var(--line-2);
}
.face-btn[aria-pressed='true'] .avatar {
  box-shadow:
    0 0 0 2px var(--card),
    0 0 0 4px var(--brand);
}
.face-btn:focus-visible {
  outline: 0;
}
.face-btn:focus-visible .avatar {
  outline: 2px solid var(--brand);
  outline-offset: 4px;
}
.face-n {
  /* Full names over two lines: role names ("bride father") must stay distinct */
  max-width: 100%;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  text-align: center;
  overflow-wrap: anywhere;
  line-height: 1.25;
  font-size: 12px;
  color: var(--ink-2);
}
.face-btn[aria-pressed='true'] .face-n {
  color: var(--ink);
}
.face-btn {
  position: relative;
}
.faces-check {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--ink-3);
}
.face-n svg {
  width: 12px;
  height: 12px;
  margin-right: 3px;
  vertical-align: -1px;
  color: var(--ink-3);
}
.face-add .avatar {
  background: none;
  border: 1.5px dashed var(--line-2);
  color: var(--ink-3);
}
.face-add .avatar svg {
  width: 18px;
  height: 18px;
}
.face-add:hover .avatar {
  border-color: var(--ink-3);
  color: var(--ink);
  box-shadow: none;
}
.face-add .face-n {
  color: var(--ink-3);
}
.pick-start {
  margin-top: 12px;
}
.face-focus {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px -12px 0;
  padding: 4px 4px 4px 12px;
  border-radius: var(--r-ctl);
  background: var(--inset);
  font-size: 13px;
}
.face-focus .t {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.face-focus .n {
  color: var(--ink-3);
  font-size: 12px;
  margin-right: auto;
  white-space: nowrap;
}
.face-focus .btn.sm {
  height: 28px;
  padding: 0 12px;
}
.menu .avatar.xs {
  width: 24px;
  height: 24px;
}
.menu .cur {
  margin-left: auto;
  width: 16px;
  height: 16px;
  color: var(--brand);
}
.pick-people {
  max-height: min(420px, 60vh);
  overflow-y: auto;
}
/* Picked by: the row is the filter; the small face button beside it links the client to a person */
.person-row {
  display: flex;
  align-items: center;
  border-top: 1px solid var(--line);
}
.person-row:last-child {
  border-radius: 0 0 var(--r-card) var(--r-card);
  overflow: hidden;
}
.person-row .person {
  border-top: 0;
  border-radius: 0;
  padding-right: 8px;
  min-width: 0;
}
.person-row:hover {
  background: var(--inset);
}
.person-row .person:hover {
  background: none;
}
.person-row:has(.person[aria-pressed='true']) {
  background: var(--brand-wash);
}
.link-face {
  flex: none;
  margin-right: 16px;
  color: var(--ink-3);
  opacity: 0.5;
}
.person-row:hover .link-face,
.link-face:focus-visible,
.link-face[aria-expanded='true'] {
  opacity: 1;
}
.consent {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 8px;
  color: var(--ink-2);
}

/* Notes: a single quiet line while empty, so it never competes with People or the photos */
.notes-card {
  padding: 16px 24px 20px;
}
.notes-card.quiet {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 24px;
}
.notes-line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-3);
}
.notes-line .spin {
  width: 12px;
  height: 12px;
}
.notes-line.bad {
  color: var(--bad);
}
.notes-card.quiet .link {
  font-size: 13px;
}
.album-note {
  margin-top: 4px;
}
.notes-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 13px;
  color: var(--ink-2);
  font-weight: 400;
}
.notes-card.quiet .notes-add {
  margin: 0;
}
.notes-add svg {
  width: 14px;
  height: 14px;
}
/* The work list first: it is what the photographer opens this card for; the album note is
   reference. Rows run edge to edge like Picked by. */
.note-rows {
  margin: 4px -24px 16px;
  border-bottom: 1px solid var(--line);
}
.note-rows .person-row:last-child {
  border-radius: 0;
}
.note-rows .avatar svg {
  width: 16px;
  height: 16px;
}
/* Selected reads as selected: the wash, the brand ink, and an × to undo it */
.note-rows .person-row.on .person {
  color: var(--brand);
  font-weight: 500;
}
.note-rows .person-row.on .avatar {
  background: var(--brand);
  color: var(--card);
}
.note-rows .person-row.on .link-face {
  opacity: 1;
  color: var(--brand);
}
.g-bar .f-on {
  background: var(--brand-wash);
  border-color: var(--brand-soft);
  color: var(--brand);
}
.g-bar .f-on .x {
  width: 14px;
  height: 14px;
  margin-left: 2px;
}
.g-bar-r {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
</style>

<style>
/* PhotoSwipe chrome in the mock's lightbox look (.lb) */
.pswp {
  --pswp-bg: oklch(15% 0.005 255);
  --pswp-root-z-index: 60; /* under the notes panel (70) */
  font-family: inherit;
}
.pswp__top-bar {
  height: auto;
  padding: 16px;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.pswp__lb-info {
  margin-right: auto;
  display: flex;
  gap: 8px;
  min-width: 0;
}
.pswp__lb-info .f {
  color: oklch(85% 0 0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pswp__lb-info .c {
  color: oklch(62% 0 0);
  margin-left: 8px;
}
.pswp__lb-picked {
  color: oklch(80% 0 0);
  margin-right: 8px;
}
/* The note in words: white while there is something to do, dimmed once done */
.pswp__lb-note {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 320px;
  height: 32px;
  margin-right: 12px;
  padding: 0 10px;
  border: 0;
  border-radius: 99px;
  background: oklch(21% 0.01 255 / 0.88);
  color: white;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.pswp__lb-note:hover {
  background: oklch(30% 0.01 255 / 0.92);
}
.pswp__lb-note .t {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pswp__lb-note.done {
  color: oklch(100% 0 0 / 0.75);
}
.pswp__lb-note svg {
  flex: none;
  width: 16px;
  height: 16px;
}
.pswp__lb-note[hidden] {
  display: none;
}
.pswp__lb-picked[hidden] {
  display: none;
}
.pswp__lb-picked svg {
  width: 16px;
  height: 16px;
  fill: white;
  stroke: white;
}
.pswp__lb-tags {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 160px);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
}
.pswp__lb-tags .lb-tag {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px 0 12px;
  border-radius: 99px;
  border: 0;
  background: oklch(25% 0.005 255);
  color: oklch(85% 0 0);
  font: inherit;
}
.pswp__lb-tags .lb-tag button {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: oklch(65% 0 0);
}
.pswp__lb-tags .lb-tag button:hover,
.pswp__lb-tags .lb-tag.add:hover {
  background: oklch(32% 0.005 255);
  color: white;
}
.pswp__lb-tags .lb-tag.add {
  padding: 0 12px 0 8px;
  gap: 4px;
}
.pswp__lb-tags svg {
  width: 14px;
  height: 14px;
}
.pswp__lb-tags[hidden] {
  display: none;
}
.pswp__button--faces-button[hidden] {
  display: none;
}
.pswp__button.pswp__button--faces-button[aria-pressed='true'] {
  background: white;
  color: var(--ink);
}
.lb-faces {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}
.lb-face {
  position: absolute;
  padding: 0;
  border: 2px solid oklch(100% 0 0 / 0.9);
  border-radius: 10px;
  background: none;
  box-shadow: 0 0 0 1px oklch(0% 0 0 / 0.3);
  pointer-events: auto;
  cursor: pointer;
}
.lb-face.none {
  border-style: dashed;
  border-color: oklch(100% 0 0 / 0.7);
}
.lb-face:hover,
.lb-face:focus-visible {
  border-color: white;
  background: oklch(100% 0 0 / 0.08);
  outline: none;
}
.lb-face span {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translate(-50%, 6px);
  padding: 2px 8px;
  border-radius: 99px;
  background: oklch(25% 0.005 255);
  color: oklch(90% 0 0);
  font-size: 12px;
  white-space: nowrap;
}
.pswp__button,
.pswp__button:hover,
.pswp__button:focus,
.pswp__button:active {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: oklch(25% 0.005 255);
  color: oklch(90% 0 0);
  opacity: 1;
}
.pswp__button:hover {
  background: oklch(32% 0.005 255);
  color: white;
}
.pswp__button svg {
  width: 18px;
  height: 18px;
}
.pswp--zoomed-in .pswp__button--zoom {
  background: white;
  color: var(--ink);
}
.pswp__button--arrow {
  margin-top: -18px;
}
.pswp__button--arrow--prev {
  left: 20px;
}
.pswp__button--arrow--next {
  right: 20px;
}
</style>
