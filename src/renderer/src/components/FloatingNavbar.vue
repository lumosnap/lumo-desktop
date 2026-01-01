<script setup lang="ts">
import { useRoute } from 'vue-router'
import { LayoutGrid, User, Notebook } from 'lucide-vue-next'

const route = useRoute()

const isActive = (path: string): boolean => route.path.startsWith(path)
</script>

<template>
  <div class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
    <div
      class="flex items-center gap-1.5 rounded-2xl bg-white/95 px-2 py-2 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/50 backdrop-blur-xl"
    >
      <!-- Albums Button -->
      <router-link
        to="/albums"
        class="group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200"
        :class="
          isActive('/albums')
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/25'
            : 'hover:bg-slate-100'
        "
      >
        <LayoutGrid
          class="h-5 w-5 transition-colors"
          :class="isActive('/albums') ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'"
        />
      </router-link>

      <!-- Workflow Button -->
      <router-link
        to="/workflow"
        class="group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200"
        :class="
          isActive('/workflow')
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/25'
            : 'hover:bg-slate-100'
        "
      >
        <Notebook
          class="h-5 w-5 transition-colors"
          :class="
            isActive('/workflow') ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'
          "
        />
      </router-link>

      <!-- Profile Button -->
      <router-link
        to="/profile"
        class="group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200"
        :class="
          isActive('/profile')
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/25'
            : 'hover:bg-slate-100'
        "
      >
        <User
          class="h-5 w-5 transition-colors"
          :class="isActive('/profile') ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'"
        />
      </router-link>
    </div>
  </div>
</template>
