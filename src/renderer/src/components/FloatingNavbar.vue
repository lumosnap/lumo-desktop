<script setup lang="ts">
import { useRoute } from 'vue-router'
import { LayoutGrid, Camera } from 'lucide-vue-next'

const route = useRoute()

const isActive = (path: string) => route.path.startsWith(path)
</script>

<template>
  <div class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
    <div
      class="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#1a1a1f]/90 to-[#1f1f24]/90 px-4 py-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
    >
      <!-- Albums Button -->
      <router-link
        to="/albums"
        class="group relative flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200"
        :class="isActive('/albums') ? 'bg-white/10' : 'hover:bg-white/5'"
      >
        <LayoutGrid
          class="h-5 w-5 transition-colors"
          :class="isActive('/albums') ? 'text-white' : 'text-white/60 group-hover:text-white'"
        />
      </router-link>

      <!-- Profile Button -->
      <router-link
        to="/profile"
        class="group relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full ring-2 transition-all duration-200"
        :class="isActive('/profile') ? 'ring-white' : 'ring-transparent hover:ring-white/30'"
      >
        <div
          class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-turquoise)] to-[var(--color-deep-teal)]"
        >
          <Camera class="h-5 w-5 text-white" />
        </div>
      </router-link>
    </div>
  </div>
</template>
