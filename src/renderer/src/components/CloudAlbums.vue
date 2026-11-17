<script setup lang="ts">
// Albums on the account that are not on this computer (a new or reinstalled computer, or a
// shoot from the other one). Each takes a folder; its photos are matched by content.
import { ref, computed, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { FolderInput, HardDrive, ImagePlus } from 'lucide-vue-next'
import { useAlbumStore } from '../stores/album'
import { toast } from '../composables/useToast'
import { addFromLabel, attachedNote, attachError, folderName, foundWhere } from '../utils/cloud'
import { albumDay, nf } from '../utils/format'
import type { CloudAlbum } from '../../../main/ipc/cloud'

defineProps<{ alone?: boolean }>()

const albumStore = useAlbumStore()
const router = useRouter()
const route = useRoute()
const el = ref<HTMLElement>()
// The match goes on when the person leaves Albums; its error then also comes as a toast.
// Asked of the route, not this instance: back on Albums, a new list shows the row's line
const onAlbums = (): boolean => route.path === '/albums'
// Thumbnails whose link failed (expired, offline) show the placeholder instead
const broken = ref<Record<string, true>>({})

const FIRST = 6
const all = ref(false)
const list = computed(() => albumStore.cloudShown)
const shown = computed(() => (all.value ? list.value : list.value.slice(0, FIRST)))

function meta(c: CloudAlbum): string {
  const day = albumDay(c.eventDate)
  const n = c.totalImages ? `${nf(c.totalImages)} photo${c.totalImages === 1 ? '' : 's'}` : 'Empty'
  return day ? `${n} · ${day}` : n
}

// One match at a time: each reads every file in its folder. In the store, so it outlives the page
const working = computed(() => albumStore.attaching)
const matching = computed(() => {
  const w = working.value
  if (!w) return ''
  const where = `“${folderName(w.folder)}”`
  return w.total
    ? `Matching ${nf(w.done ?? 0)} of ${nf(w.total)} photos in ${where}…`
    : `Matching the photos in ${where}. A big folder takes a few minutes.`
})
// One live region that is always there, so Chromium reads its text when it changes. It says
// the start, not every count; the end is the toast or the row's alert
const said = ref('')

async function choose(c: CloudAlbum): Promise<void> {
  if (albumStore.attaching) return
  const folder = await window.api.dialog.openDirectory()
  if (folder) await attach(c, folder)
}

// A row whose folder is on a plugged-in drive skips the folder dialog
async function attach(c: CloudAlbum, folder: string): Promise<void> {
  if (albumStore.attaching) return
  // Its row if it stays (an error), else the row after it, else the one before
  const ids = shown.value.map((x) => x.id)
  const at = ids.indexOf(c.id)
  const next = [c.id, ids[at + 1], ids[at - 1]]
  said.value = `Matching the photos in “${folderName(folder)}”.`
  const res = await albumStore.attach(c, folder)
  said.value = ''
  if (!res) return // signed out meanwhile
  if (res.success)
    toast(attachedNote(res), { label: 'Open', run: () => router.push(`/albums/${res.albumId}`) })
  else if (res.error === 'LOCAL') toast(`“${c.title}” is already on this computer.`)
  else if (res.error === 'NOT_FOUND') toast(`“${c.title}” is no longer on your account.`)
  else if (!onAlbums())
    toast(`“${c.title}” isn’t on this computer yet. ${attachError(res.error)}`, {
      label: 'Show',
      run: () => router.push('/albums')
    })
  if (!onAlbums()) return
  // The row that had the focus may be gone: the row that took its place takes it
  await nextTick()
  if (document.activeElement !== document.body) return
  const row = next
    .map((id) => id && el.value?.querySelector(`.cloud-row[data-id="${CSS.escape(id)}"]`))
    .find(Boolean)
  ;(row || el.value?.querySelector('.cloud-row:last-child'))
    ?.querySelector<HTMLButtonElement>('.btn.ghost')
    ?.focus()
}

// The rows that come in start at the 7th: the focus goes there, not back to the page
async function showAll(): Promise<void> {
  all.value = true
  await nextTick()
  const row = el.value?.querySelectorAll<HTMLElement>('.cloud-row')[FIRST]
  const btn = row?.querySelector<HTMLButtonElement>('.btn.ghost')
  ;(btn && !btn.disabled ? btn : row)?.focus()
}
</script>

<template>
  <section
    v-if="list.length"
    ref="el"
    class="card cloud"
    :class="{ alone }"
    aria-labelledby="cloud-h"
  >
    <h2 id="cloud-h">{{ alone ? 'Albums on your account' : 'Not on this computer' }}</h2>
    <p class="sub">
      Choose the folder that has an album’s photos. Photos already online aren’t uploaded again.
    </p>
    <ul>
      <li v-for="c in shown" :key="c.id" class="cloud-row" :data-id="c.id" tabindex="-1">
        <div class="thumb">
          <img
            v-if="c.thumbnailUrl && !broken[c.id]"
            :src="c.thumbnailUrl"
            alt=""
            loading="lazy"
            @error="broken[c.id] = true"
          />
          <ImagePlus v-else />
        </div>
        <div class="txt">
          <div class="t">{{ c.title }}</div>
          <div class="m num">{{ meta(c) }}</div>
          <div v-if="working?.album.id === c.id" id="cloud-matching" class="m num">
            {{ matching }}
          </div>
          <p v-else-if="albumStore.attachErrors[c.id]" class="err" role="alert">
            <span class="dot bad"></span>{{ attachError(albumStore.attachErrors[c.id]) }}
          </p>
          <div v-else-if="c.found" :id="`found-${c.id}`" class="m" :title="c.found.folder">
            {{ foundWhere(c.found) }}
          </div>
        </div>
        <div class="acts">
          <button
            v-if="c.found && working?.album.id !== c.id"
            class="btn quiet sm"
            :disabled="!!working"
            :aria-label="`Other folder for ${c.title}`"
            :title="working ? 'One album at a time' : ''"
            :aria-describedby="working ? 'cloud-matching' : undefined"
            @click="choose(c)"
          >
            Other folder…
          </button>
          <button
            class="btn ghost sm"
            :disabled="!!working"
            :aria-busy="working?.album.id === c.id"
            :aria-label="
              working?.album.id === c.id
                ? undefined
                : c.found
                  ? `${addFromLabel(c.found)}: ${c.title}`
                  : `Choose folder for ${c.title}`
            "
            :title="working && working.album.id !== c.id ? 'One album at a time' : ''"
            :aria-describedby="
              working
                ? 'cloud-matching'
                : c.found && !albumStore.attachErrors[c.id]
                  ? `found-${c.id}`
                  : undefined
            "
            @click="c.found ? attach(c, c.found.folder) : choose(c)"
          >
            <template v-if="working?.album.id === c.id"
              ><span class="spin now"></span>Matching…</template
            >
            <template v-else-if="c.found"><HardDrive />{{ addFromLabel(c.found) }}</template>
            <template v-else><FolderInput />Choose folder…</template>
          </button>
        </div>
      </li>
    </ul>
    <button v-if="!all && list.length > FIRST" class="btn quiet sm more" @click="showAll">
      Show all {{ nf(list.length) }}
    </button>
    <p class="vh" role="status">{{ said }}</p>
  </section>
</template>

<style scoped>
.cloud {
  margin: 24px 8px 0;
  padding: 16px 8px 8px;
}
.cloud.alone {
  margin-top: 0;
}
.cloud h2,
.cloud > .sub {
  padding: 8px 8px 0;
}
.cloud > .sub {
  margin: 0 0 8px;
  max-width: 62ch;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cloud-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 8px;
  border-top: 1px solid var(--line);
}
.thumb {
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: var(--inset);
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.txt .t {
  font-size: 15px;
  overflow-wrap: anywhere;
}
.txt .m {
  font-size: 13px;
  color: var(--ink-3);
}
.txt .err {
  margin-top: 4px;
  font-size: 13px;
}
.acts {
  display: flex;
  gap: 8px;
}
.more {
  margin: 8px 8px 0;
}
</style>
