<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { thumbHashToDataURL } from 'thumbhash'
import { tagLabel } from '../utils/tags'
import {
  Heart,
  Check,
  FolderSearch,
  MessageSquare,
  ImageOff,
  Layers,
  NotebookPen
} from 'lucide-vue-next'

interface TileImage {
  originalFilename: string
  localFilePath: string
  favoritedBy?: string[]
  notesCount?: number
  thumbhash?: string | null
  tags?: string[]
}

const props = defineProps<{
  image: TileImage
  burst?: unknown[]
  index: number
  status: 'Processing' | 'Failed' | 'Success'
  thumb: string
  selected: boolean
  myNote?: string // the photographer's private note
  noteState?: 'open' | 'done' | null // set when it has a note, yours or the client's
}>()
const emit = defineEmits<{
  open: [e: MouseEvent]
  toggle: []
  tip: [e: Event, names: string[]]
  untip: []
  notes: [tab: 'client' | 'mine']
  reveal: []
}>()

// Blurry ThumbHash preview behind the thumbnail while it loads
const placeholder = ref<string>()
onMounted(() => {
  const hash = props.image.thumbhash
  if (!hash || props.status === 'Failed') return
  try {
    const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
    placeholder.value = `url(${thumbHashToDataURL(bytes)}) center / cover no-repeat`
  } catch {
    // a bad hash just means no placeholder
  }
})
</script>

<template>
  <div class="ph" :class="{ on: selected, failed: status === 'Failed' }">
    <a
      :href="`file://${image.localFilePath}`"
      :data-pswp-index="index"
      target="_blank"
      :aria-label="
        image.originalFilename +
        (image.favoritedBy?.length ? ', picked by ' + image.favoritedBy.join(', ') : '') +
        (noteState ? `, notes ${noteState === 'done' ? 'done' : 'to do'}` : '') +
        (burst ? `, burst of ${burst.length}` : '')
      "
      style="
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        color: inherit;
        text-decoration: none;
      "
      :style="{ background: placeholder }"
      @click="emit('open', $event)"
    >
      <span v-if="status === 'Failed'"
        ><ImageOff /><br />{{ image.originalFilename }}<br />couldn't be read</span
      >
      <img
        v-else
        :src="thumb"
        :alt="image.originalFilename"
        loading="lazy"
        @error="(e) => ((e.target as HTMLImageElement).src = `file://${image.localFilePath}`)"
      />
    </a>
    <span v-if="status === 'Failed'" class="chip">Failed</span>
    <button
      class="sel-ctl"
      :aria-pressed="selected"
      :aria-label="
        `Select ${image.originalFilename}` + (burst ? ` and its ${burst.length} frames` : '')
      "
      @click.stop="emit('toggle')"
    >
      <Check />
    </button>
    <div class="chips">
      <span v-if="burst" class="chip" :title="`Burst of ${burst.length}`">
        <Layers />{{ burst.length }}
      </span>
      <span
        v-if="image.favoritedBy?.length"
        class="chip fav"
        tabindex="0"
        :aria-label="`Picked by ${image.favoritedBy.join(', ')}`"
        @pointerenter="emit('tip', $event, image.favoritedBy)"
        @pointerleave="emit('untip')"
        @focus="emit('tip', $event, image.favoritedBy)"
        @blur="emit('untip')"
      >
        <Heart />{{ image.favoritedBy.length }}
      </span>
      <!-- The client's notes come first: top right with the hearts. Ink while to do, plain once done -->
      <button
        v-if="noteState && image.notesCount"
        class="chip note"
        :class="noteState"
        :aria-label="`${image.notesCount} from your client. ${noteState === 'done' ? 'Done' : 'To do'}`"
        @click.stop="emit('notes', 'client')"
      >
        <Check v-if="noteState === 'done'" class="ok" /><MessageSquare />{{ image.notesCount }}
      </button>
    </div>
    <!-- Your own note: bottom right, apart from the client's. On hover it rises above the name. -->
    <button
      v-if="noteState && myNote"
      class="chip note mine"
      :class="noteState"
      :aria-label="`Your note: ${myNote}. ${noteState === 'done' ? 'Done' : 'To do'}`"
      :title="`Your note: ${myNote}`"
      @click.stop="emit('notes', 'mine')"
    >
      <Check v-if="noteState === 'done'" class="ok" /><NotebookPen />
    </button>
    <span v-if="status === 'Processing'" class="chip proc">
      <span class="spin brand now" style="width: 12px; height: 12px; border-width: 1.5px"></span
      >Processing
    </span>
    <div class="fname">
      <span class="fn">
        {{ image.originalFilename }}
        <span v-if="myNote" class="tg">Your note: {{ myNote }}</span>
        <span v-else-if="image.tags?.length" class="tg">{{
          image.tags.slice(0, 4).map(tagLabel).join(' · ')
        }}</span>
      </span>
      <button
        aria-label="Show original in Finder"
        title="Show original in Finder"
        @click.stop="emit('reveal')"
      >
        <FolderSearch />
      </button>
    </div>
  </div>
</template>
