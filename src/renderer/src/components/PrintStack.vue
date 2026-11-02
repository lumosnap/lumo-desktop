<script setup lang="ts">
// The delight piece: every delivered photo as a 6x4 print, piled on a desk in the sidebar.
// Drag a print out, click it to find its album, double-click a loose one to turn it over,
// drop it back on the pile (or press Home) to put it back.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAlbumStore, type Album } from '../stores/album'

const STACK_KEY = 'lumo:hidePrintStack'
const DESK_KEY = 'lumo:desk'
const HINT_KEY = 'lumo:deskHint'
const PAPER_MM = 0.3 // one 6x4 print on photo paper
const MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-12, 0],
  ArrowRight: [12, 0],
  ArrowUp: [0, -12],
  ArrowDown: [0, 12]
}

type Spot = { x: number; y: number; r: number }

const router = useRouter()
const albumStore = useAlbumStore()

const read = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}
const hidden = ref(false)
const readHidden = (): void => {
  hidden.value = read(() => localStorage.getItem(STACK_KEY) === '1', false)
}
readHidden()
const placed = ref<Record<string, Spot>>(
  read(() => JSON.parse(localStorage.getItem(DESK_KEY) || '{}'), {})
)
const deskHint = ref(read(() => localStorage.getItem(HINT_KEY) !== 'done', true))
const saveDesk = (): void => {
  try {
    localStorage.setItem(DESK_KEY, JSON.stringify(placed.value))
    localStorage.setItem(HINT_KEY, 'done')
  } catch {
    /* storage full or blocked: the desk just won't persist */
  }
}

const nf = (n: number): string => n.toLocaleString('en-IN')
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches
// album ids are strings; the mock's per-print jitter needs a small stable number
const seedOf = (id: string): number => {
  let n = 7
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) % 9973
  return n
}
const standWords = (cm: number): string =>
  cm >= 200
    ? 'Taller than a light stand.'
    : cm >= 160
      ? 'Almost a light stand.'
      : cm >= 80
        ? 'About half a light stand.'
        : cm >= 40
          ? 'A quarter of a light stand.'
          : 'Knee-high, so far.'
const backDate = (a: Album): string =>
  a.eventDate
    ? new Date(a.eventDate).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      })
    : ''

const total = computed(() => albumStore.albums.reduce((n, a) => n + (a.totalImages || 0), 0))
const cm = computed(() => Math.round((total.value * PAPER_MM) / 10))
const covers = computed(() => albumStore.albums.filter((a) => a.thumbnail && a.totalImages))
// the paper block under the prints: never thinner than the mock's pile (a 2 px line reads as a rule,
// not as prints), and it still grows with the work up to 24 px
const h = computed(() => Math.max(18, Math.min(24, Math.round(Math.sqrt(total.value) / 2.5))))
const loose = computed(() => covers.value.filter((a) => placed.value[a.id]))
const pile = computed(() =>
  covers.value
    .filter((a) => !placed.value[a.id])
    .slice(0, 5)
    .reverse()
)

const deskEl = ref<HTMLElement>()
const pileEl = ref<HTMLElement>()
const pileOpen = ref(false)
const pileReady = ref(false)
const dropPrint = ref(false)
const flipped = ref<string | null>(null)
const hover = ref<string | null>(null)
const counted = ref<number | null>(null)
const live = ref('')
const outs = ref<Record<string, number>>({})
const taking = ref(false) // a dragged print is over the pile and will go back on it
const hintText = computed(() =>
  deskHint.value ? 'Drag a print out, or click it to find its album' : ''
)

const timers = new Set<ReturnType<typeof setTimeout>>()
const later = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
  return t
}
let pileT: ReturnType<typeof setTimeout> | undefined
let clickT: ReturnType<typeof setTimeout> | undefined
let raf = 0

const announce = (m: string): void => {
  live.value = ''
  later(() => (live.value = m), 50)
}

const titleOf = (id: string): string => covers.value.find((a) => a.id === id)?.title ?? ''
const label = (a: Album): string =>
  `${a.title}, ${nf(a.totalImages)} photos. Enter finds the album, arrow keys move the print${placed.value[a.id] ? ', Space turns it over, Home puts it back on the pile' : ''}.`

/* drag: a press without moving finds the album */
type Drag = {
  id: string
  sx: number
  sy: number
  px: number
  py: number
  ox: number
  oy: number
  w: number
  h: number
  moved: boolean
}
let drag: Drag | null = null
const dragPos = ref<{ id: string; x: number; y: number; dr: number } | null>(null)

function dragStyle(id: string, px: number, py: number): string {
  const d = dragPos.value
  return d && d.id === id ? `;left:${d.x - px}px;top:${d.y - py}px;bottom:auto;--dr:${d.dr}deg` : ''
}
function pileStyle(a: Album, k: number): string {
  const top = pile.value.length - 1
  const s = seedOf(a.id)
  const rr = k === top ? -1.5 : (((s * 37) % 9) - 4) * 1.6
  const x = k === top ? 0 : (((s * 53) % 9) - 4) * 2
  const fx = (k - top / 2) * 10
  const side = outs.value[a.id] ?? (fx > 0 ? 22 : -22) // same side the fan exposes it on
  // the outer prints are already fanned 20 px out; a full 22 px push would cut them on the sidebar edge
  const outward = Math.sign(side) === Math.sign(x + fx)
  const out = outward ? Math.sign(side) * Math.min(22, Math.max(0, 24 - Math.abs(x + fx))) : side
  const p = pileEl.value
  return `--x:${x}px;--y:${k * 1.5}px;--r:${rr}deg;--fx:${fx}px;--k:${k};--out:${out}px${dragStyle(a.id, p?.offsetLeft ?? 0, p?.offsetTop ?? 0)}`
}
function looseStyle(a: Album): string {
  const q = placed.value[a.id]
  return `left:${q.x}px;top:${q.y}px;--r:${q.r}deg${dragStyle(a.id, 0, 0)}`
}

function down(e: PointerEvent, a: Album): void {
  if (e.button !== 0 || !deskEl.value) return
  const el = e.currentTarget as HTMLElement
  const p = el.parentElement === pileEl.value ? pileEl.value : null
  const px = p?.offsetLeft ?? 0
  const py = p?.offsetTop ?? 0
  const d = deskEl.value.getBoundingClientRect()
  drag = {
    id: a.id,
    sx: e.clientX,
    sy: e.clientY,
    px,
    py,
    ox: el.offsetLeft + px,
    oy: el.offsetTop + py,
    w: d.width,
    h: d.height,
    moved: false
  }
  el.setPointerCapture(e.pointerId)
}
function move(e: PointerEvent): void {
  if (!drag) return
  const dx = e.clientX - drag.sx
  const dy = e.clientY - drag.sy
  if (!drag.moved && Math.hypot(dx, dy) < 5) return
  if (!drag.moved) {
    drag.moved = true
    flip(drag.id, false)
  }
  dragPos.value = {
    id: drag.id,
    x: clamp(drag.ox + dx, -6, drag.w - 110),
    y: clamp(drag.oy + dy, 0, drag.h - 80),
    dr: dragPos.value?.dr ?? (dx > 0 ? 5 : -5)
  }
  // over the pile, the pile loosens to take the print back, and the caption says so
  const over = overPile(e.clientX, e.clientY)
  if (over !== taking.value) {
    taking.value = pileOpen.value = over
    hover.value = over ? 'Let go to put it back on the pile' : null
  }
}
// The drop target is the pile itself, with room around it: the paper block, one print above it, 12 px each side
function overPile(x: number, y: number): boolean {
  const b = pileEl.value?.querySelector('.edge')?.getBoundingClientRect()
  return !!b && x > b.left - 12 && x < b.right + 12 && y > b.top - 96 && y < b.bottom + 12
}
function up(e: PointerEvent): void {
  if (!drag) return
  const { id, moved } = drag
  const pos = dragPos.value
  const back = taking.value
  drag = null
  dragPos.value = null
  taking.value = false
  if (moved && back) {
    hover.value = null
    return void putBack(
      id,
      (e.currentTarget as HTMLElement).querySelector('.paper')?.getBoundingClientRect()
    )
  }
  if (!moved || !pos) {
    if (!placed.value[id]) return void findAlbum(id)
    if (flipped.value === id) return flip(id, false)
    if (clickT) {
      clearTimeout(clickT)
      clickT = undefined
      return flip(id, true)
    }
    clickT = later(() => {
      clickT = undefined
      findAlbum(id)
    }, 260)
    return
  }
  placed.value = {
    ...placed.value,
    [id]: {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      r: Math.round((Math.random() * 12 - 6) * 10) / 10
    }
  }
  deskHint.value = false
  pileOpen.value = pileReady.value = false
  saveDesk()
}
function cancelDrag(): void {
  drag = null
  dragPos.value = null
  if (taking.value) taking.value = pileOpen.value = false
  hover.value = null
}

// Put one print back in its place in the pile: it settles from where it was let go (FLIP, transform only)
async function putBack(id: string, from?: DOMRect): Promise<HTMLElement | undefined> {
  const wasOut = !!placed.value[id]
  const rest = { ...placed.value }
  delete rest[id]
  placed.value = rest
  if (flipped.value === id) flipped.value = null
  pileOpen.value = pileReady.value = false
  saveDesk()
  if (wasOut) {
    hover.value = 'Back on the pile'
    later(() => {
      if (hover.value === 'Back on the pile') hover.value = null
    }, 2200)
    announce(`Back on the pile: ${titleOf(id)}`)
  }
  await nextTick()
  const el =
    pileEl.value?.querySelector<HTMLElement>(`.print[data-id="${CSS.escape(id)}"]`) ?? undefined
  if (reduced()) return el
  const edge = pileEl.value?.querySelector('.edge')
  edge?.animate(
    [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.82)' }, { transform: 'scaleY(1)' }],
    {
      duration: 220,
      delay: 200,
      easing: 'ease-out'
    }
  )
  const paper = el?.querySelector<HTMLElement>('.paper')
  // Under the five shown it has no print of its own to fly; the paper block takes it
  if (!el || !paper || !from) return el
  // the same button may still be mid-transition from its drag lift; land it at once, the paper does the move
  el.style.transition = 'none'
  const to = paper.getBoundingClientRect()
  el.style.transition = ''
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  paper.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) rotate(${dx > 0 ? 5 : -5}deg) scale(1.07)` },
      { transform: 'none' }
    ],
    { duration: 380, easing: 'cubic-bezier(.3, 1.25, .5, 1)' }
  )
  return el
}

function flip(id: string, on: boolean): void {
  if ((flipped.value === id) === on) return
  flipped.value = on ? id : null
  if (on) announce(`Back of the print: ${titleOf(id)}`)
}
// a turned print turns back when the pointer or focus leaves it
function leavePrint(e: PointerEvent, id: string): void {
  if (flipped.value === id && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
    flip(id, false)
}

// Find, don't open: show the Albums list and flash the card, as in the mock.
async function findAlbum(id: string): Promise<void> {
  announce(`Showing ${titleOf(id)}`)
  if (router.currentRoute.value.path !== '/albums') await router.push('/albums')
  // The grid may still be loading after navigation, so look for the card for up to 2 s
  const until = performance.now() + 2000
  const go = (): void => {
    const card = document.querySelector<HTMLElement>(`.album[data-id="${CSS.escape(id)}"]`)
    if (!card) {
      if (performance.now() < until) requestAnimationFrame(go)
      return
    }
    card.classList.remove('flash')
    void card.offsetWidth // restart the animation on a repeat click
    card.classList.add('flash')
    card.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
    setTimeout(() => card.classList.remove('flash'), 1900)
  }
  go()
}

async function nudge(el: HTMLElement, id: string, dx: number, dy: number): Promise<void> {
  const d = deskEl.value
  if (!d) return
  const inPile = el.parentElement === pileEl.value
  const q = placed.value[id] || {
    x: el.offsetLeft + (inPile && pileEl.value ? pileEl.value.offsetLeft : 0),
    y: d.clientHeight - el.offsetHeight - 40,
    r: -3
  }
  placed.value = {
    ...placed.value,
    [id]: {
      ...q,
      x: clamp(q.x + dx, -6, d.clientWidth - 110),
      y: clamp(q.y + dy, 0, d.clientHeight - 80)
    }
  }
  deskHint.value = false
  saveDesk()
  await nextTick()
  d.querySelector<HTMLElement>(`.print[data-id="${CSS.escape(id)}"]`)?.focus()
}
function key(e: KeyboardEvent, a: Album): void {
  const mv = MOVES[e.key]
  if (mv) {
    e.preventDefault()
    nudge(e.currentTarget as HTMLElement, a.id, mv[0], mv[1])
  } else if (e.key === 'Home' && placed.value[a.id]) {
    e.preventDefault()
    const from = (e.currentTarget as HTMLElement).querySelector('.paper')?.getBoundingClientRect()
    putBack(a.id, from).then((el) =>
      (el ?? pileEl.value?.querySelector<HTMLElement>('.print.top'))?.focus()
    )
  } else if (e.key === ' ' && placed.value[a.id]) {
    e.preventDefault()
    flip(a.id, flipped.value !== a.id)
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    findAlbum(a.id)
  }
}

/* the pile unfolds when the hand enters its zone and stays open until it leaves */
function pileOver(): void {
  if (pileOpen.value || drag) return
  pileOpen.value = true
  clearTimeout(pileT)
  pileT = later(() => (pileReady.value = true), 450)
}
function pileOut(e: PointerEvent): void {
  if (!pileOpen.value || drag || pileEl.value?.contains(e.relatedTarget as Node)) return
  pileOpen.value = pileReady.value = false
  clearTimeout(pileT)
}
function deskOver(e: PointerEvent): void {
  if (drag) return
  const el = (e.target as Element).closest<HTMLElement>('.print:not(.blank)')
  const a = el ? covers.value.find((x) => x.id === el.dataset.id) : undefined
  hover.value = a ? `${a.title} · ${nf(a.totalImages)} photos` : null
  // a back print slides out toward the side the pointer came from
  if (el && a && el.parentElement === pileEl.value && !el.classList.contains('top')) {
    const t = pileEl.value.querySelector('.print.top .paper')?.getBoundingClientRect()
    if (t) outs.value = { ...outs.value, [a.id]: e.clientX < t.left + t.width / 2 ? -22 : 22 }
  }
}

async function tidy(): Promise<void> {
  // FLIP: note where each loose print is, tidy for real, then fly each one home from where it was
  const before: Record<string, Spot> = {}
  deskEl.value?.querySelectorAll<HTMLElement>('.print.loose').forEach((el) => {
    const b = el.querySelector('.paper')!.getBoundingClientRect()
    const id = el.dataset.id!
    before[id] = { x: b.left + b.width / 2, y: b.top + b.height / 2, r: placed.value[id]?.r || 0 }
  })
  placed.value = {}
  flipped.value = null
  pileOpen.value = pileReady.value = false
  saveDesk()
  await nextTick()
  if (reduced()) return announce('All prints are back on the pile')
  // Prints land a little crooked; the last one floats down like paper; then the pile is jogged square,
  // the way you knock a stack of prints on the table to line up the edges.
  const pileNode = pileEl.value
  const edge = pileNode?.querySelector('.edge')
  const back = [...(pileNode?.querySelectorAll<HTMLElement>('.print') ?? [])].filter(
    (el) => before[el.dataset.id!]
  ) // bottom to top
  const GAP = 120
  const FLY = 640
  const FLOAT = 1050
  const held: { paper: HTMLElement; crooked: string; anim: Animation }[] = []
  back.forEach((el, k) => {
    const b = before[el.dataset.id!]
    const paper = el.querySelector<HTMLElement>('.paper')!
    const n = paper.getBoundingClientRect()
    const dx = b.x - (n.left + n.width / 2)
    const dy = b.y - (n.top + n.height / 2)
    const dr = b.r - (parseFloat(el.style.getPropertyValue('--r')) || 0)
    const lean = dx > 0 ? 5 : -5
    // where it lands before the jog: off by a few px and degrees,
    // varied per print, so it reads as a pile thrown together, not a pattern
    const seed = seedOf(el.dataset.id!) * 7919 + k * 31
    const sr = k % 2 ? 1 : -1
    const sx = (seed >> 3) % 2 ? sr : -sr // leans alternate
    const crooked = `translate(${sx * (7 + (seed % 9))}px, ${-2 - (seed % 5)}px) rotate(${sr * (5 + ((seed >> 2) % 6))}deg)`
    const last = k === back.length - 1
    const delay = k * GAP
    const frames = last
      ? [
          { transform: `translate(${dx}px, ${dy}px) rotate(${dr}deg)` },
          {
            transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 46}px) rotate(${dr * 0.4 + lean}deg) scale(1.06)`,
            offset: 0.3
          },
          { transform: 'translate(14px, -30px) rotate(9deg) scale(1.04)', offset: 0.5 },
          { transform: 'translate(-10px, -16px) rotate(-7deg) scale(1.02)', offset: 0.68 },
          { transform: 'translate(6px, -5px) rotate(4deg)', offset: 0.84 },
          { transform: crooked }
        ]
      : [
          { transform: `translate(${dx}px, ${dy}px) rotate(${dr}deg)` },
          {
            transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 34}px) rotate(${dr * 0.5 + lean}deg) scale(1.05)`,
            offset: 0.4
          },
          { transform: `translate(0, -12px) rotate(${lean * 0.4}deg) scale(1.02)`, offset: 0.78 },
          { transform: crooked }
        ]
    const dur = last ? FLOAT : FLY
    held.push({
      paper,
      crooked,
      anim: paper.animate(frames, {
        duration: dur,
        delay,
        easing: last ? 'cubic-bezier(.35, .4, .45, 1)' : 'cubic-bezier(.3, .7, .4, 1)',
        fill: 'both'
      })
    })
    edge?.animate(
      [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.82)' }, { transform: 'scaleY(1)' }],
      { duration: 220, delay: delay + dur - 60, easing: 'ease-out' }
    )
  })
  const HOLD = 520 // a beat to see the mess before the tap
  later(
    () => {
      // the jog: one tap down, and every crooked print snaps square together
      pileNode?.animate(
        [
          { transform: 'none' },
          { transform: 'translateY(4px) scaleY(.985)', offset: 0.35 },
          { transform: 'translateY(-1px)', offset: 0.7 },
          { transform: 'none' }
        ],
        { duration: 300, easing: 'ease-out' }
      )
      edge?.animate(
        [
          { transform: 'scaleY(1)' },
          { transform: 'scaleY(.7)', offset: 0.35 },
          { transform: 'scaleY(1)' }
        ],
        { duration: 300, easing: 'ease-out' }
      )
      held.forEach(({ paper, crooked, anim }) => {
        paper.animate(
          [
            { transform: crooked },
            { transform: 'translate(0, 1px) rotate(0.4deg)', offset: 0.6 },
            { transform: 'none' }
          ],
          {
            duration: 300,
            delay: 20,
            easing: 'cubic-bezier(.3, 1.4, .5, 1)',
            fill: 'backwards'
          }
        )
        anim.cancel()
      })
      hover.value = 'Back on the pile'
      later(() => {
        if (hover.value === 'Back on the pile') hover.value = null
      }, 2200)
      announce('All prints are back on the pile')
    },
    (back.length - 1) * GAP + FLOAT + HOLD
  )
}

/* new photos delivered: the top print drops on and the count runs up */
function countUp(from: number, to: number): void {
  if (reduced()) return
  const t0 = performance.now()
  const step = (t: number): void => {
    const f = Math.min(1, (t - t0) / 900)
    counted.value = f < 1 ? Math.round(from + (to - from) * (1 - Math.pow(1 - f, 3))) : null
    if (f < 1) raf = requestAnimationFrame(step)
  }
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(step)
}
let primed = albumStore.status === 'ready' // the first load is not a delivery
watch(total, (to, from) => {
  if (primed && to > from) {
    dropPrint.value = true
    later(() => (dropPrint.value = false), 900)
    countUp(from, to)
  }
  primed = albumStore.status === 'ready'
})

onMounted(() => window.addEventListener('lumo:printstack', readHidden))
onBeforeUnmount(() => {
  window.removeEventListener('lumo:printstack', readHidden)
  timers.forEach(clearTimeout)
  cancelAnimationFrame(raf)
})
</script>

<template>
  <template v-if="!hidden && albumStore.status === 'ready'">
    <span class="vh" aria-live="polite">{{ live }}</span>
    <template v-if="!covers.length">
      <div class="desk" aria-hidden="true">
        <div class="pile" style="--h: 0px">
          <div
            class="print blank pile-blank"
            style="left: calc(50% - 58px); bottom: 8px; transform: rotate(-2deg)"
          ></div>
        </div>
      </div>
      <div class="desk-cap"><b>Your first print</b>Every photo you deliver lands on this pile.</div>
    </template>
    <template v-else>
      <div
        ref="deskEl"
        class="desk"
        role="group"
        :aria-label="`Print stack: ${nf(total)} photos delivered, ${cm} cm as 6 by 4 prints`"
        @pointerover="deskOver"
        @pointerleave="hover = null"
      >
        <div
          ref="pileEl"
          class="pile"
          :class="{ open: pileOpen, ready: pileReady }"
          :style="`--h:${h}px`"
          @pointerover="pileOver"
          @pointerout="pileOut"
        >
          <span class="edge"></span>
          <button
            v-for="(a, k) in pile"
            :key="a.id"
            class="print"
            :class="{
              top: k === pile.length - 1,
              drop: k === pile.length - 1 && dropPrint,
              dragging: dragPos?.id === a.id
            }"
            :style="pileStyle(a, k)"
            :data-id="a.id"
            :title="a.title"
            :aria-label="label(a)"
            @pointerdown="down($event, a)"
            @pointermove="move"
            @pointerup="up"
            @pointercancel="cancelDrag"
            @keydown="key($event, a)"
          >
            <span class="paper"
              ><span class="flip">
                <span class="face front"
                  ><img :src="`file://${a.thumbnail}`" alt="" draggable="false"
                /></span>
                <span
                  class="face back"
                  aria-hidden="true"
                  :style="`--hand:${((seedOf(a.id) * 29) % 7) - 3}deg`"
                  ><span>{{ a.title }}</span
                  ><small>{{ backDate(a) }}</small></span
                >
              </span></span
            >
          </button>
        </div>
        <button
          v-for="a in loose"
          :key="a.id"
          class="print loose"
          :class="{ flipped: flipped === a.id, dragging: dragPos?.id === a.id }"
          :style="looseStyle(a)"
          :data-id="a.id"
          :title="a.title"
          :aria-label="label(a)"
          @pointerdown="down($event, a)"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="cancelDrag"
          @pointerout="leavePrint($event, a.id)"
          @focusout="flip(a.id, false)"
          @keydown="key($event, a)"
        >
          <span class="paper"
            ><span class="flip">
              <span class="face front"
                ><img :src="`file://${a.thumbnail}`" alt="" draggable="false"
              /></span>
              <span
                class="face back"
                aria-hidden="true"
                :style="`--hand:${((seedOf(a.id) * 29) % 7) - 3}deg`"
                ><span>{{ a.title }}</span
                ><small>{{ backDate(a) }}</small></span
              >
            </span></span
          >
        </button>
        <button v-if="loose.length" class="link tidy" @click="tidy">Tidy the pile</button>
      </div>
      <div class="desk-cap">
        <b class="num">{{ nf(counted ?? total) }} photos delivered</b>As 6×4 prints, a pile
        {{ cm }} cm tall. {{ standWords(cm)
        }}<span class="which" aria-live="polite">{{ hover ?? hintText }}</span>
      </div>
    </template>
  </template>
</template>
