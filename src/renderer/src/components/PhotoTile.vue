<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { thumbHashToDataURL } from 'thumbhash'
import { Heart, Check, FolderSearch, MessageSquare, ImageOff, Layers } from 'lucide-vue-next'

interface TileImage {
  originalFilename: string
  localFilePath: string
  favoritedBy?: string[]
  notesCount?: number
  thumbhash?: string | null
}

const props = defineProps<{
  image: TileImage
  burst?: unknown[]
  index: number
  status: 'Processing' | 'Failed' | 'Success'
  thumb: string
  selected: boolean
}>()
const emit = defineEmits<{
  open: [e: MouseEvent]
  toggle: []
  tip: [e: Event, names: string[]]
  untip: []
  notes: []
  reveal: []
}>()

const firstName = (s: string): string => s.split(' ')[0]

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
        (image.favoritedBy?.length
          ? ', picked by ' + image.favoritedBy.map(firstName).join(', ')
          : '') +
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
      <button
        v-if="(image.notesCount || 0) > 0"
        class="chip"
        :aria-label="`${image.notesCount} client notes`"
        @click.stop="emit('notes')"
      >
        <MessageSquare />{{ image.notesCount }}
      </button>
    </div>
    <span v-if="status === 'Processing'" class="chip proc">
      <span class="spin brand" style="width: 12px; height: 12px; border-width: 1.5px"></span
      >Processing
    </span>
    <div class="fname">
      <span>{{ image.originalFilename }}</span>
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
