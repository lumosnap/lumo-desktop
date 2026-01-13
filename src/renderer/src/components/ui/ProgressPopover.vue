<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, CheckCircle2 } from 'lucide-vue-next'
import Dropdown from './Dropdown.vue'

interface UploadProgress {
  albumId: string
  total: number
  pending: number
  compressing: number
  uploading: number
  complete: number
  failed: number
}

const props = defineProps<{
  progress: UploadProgress | null
  isProcessing: boolean
}>()

const progressPercentage = computed(() => {
  if (!props.progress || !props.progress.total) return 0
  // Weight progress: compressing = 25%, uploading = 75%, complete = 100%
  const weightedProgress =
    props.progress.complete + props.progress.uploading * 0.75 + props.progress.compressing * 0.25
  return (weightedProgress / props.progress.total) * 100
})

const statusText = computed(() => {
  if (!props.progress) return 'Ready'
  if (props.progress.failed > 0) return 'Completed with errors'
  if (props.progress.complete === props.progress.total) return 'Completed'
  if (props.progress.uploading > 0) return 'Uploading...'
  if (props.progress.compressing > 0) return 'Compressing...'
  return 'Processing...'
})
</script>

<template>
  <div v-if="isProcessing || progress" class="relative z-50">
    <Dropdown align="right" :close-on-click="false">
      <template #trigger>
        <button
          class="flex items-center gap-3 rounded-full bg-white border border-slate-200 pl-1 pr-4 py-1 hover:bg-slate-50 shadow-sm hover:shadow transition-all"
        >
          <div class="relative flex h-8 w-8 items-center justify-center">
            <!-- Spinner Background -->
            <svg class="h-full w-full rotate-[-90deg]" viewBox="0 0 36 36">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#e2e8f0"
                stroke-width="3"
              />
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="url(#gradient)"
                stroke-width="3"
                :stroke-dasharray="`${progressPercentage}, 100`"
                class="transition-all duration-300 ease-out"
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#6366f1" />
                  <stop offset="100%" stop-color="#a855f7" />
                </linearGradient>
              </defs>
            </svg>
            <div class="absolute inset-0 flex items-center justify-center">
              <Loader2
                v-if="progressPercentage < 100"
                class="h-4 w-4 text-indigo-500 animate-spin"
              />
              <CheckCircle2 v-else class="h-4 w-4 text-emerald-500" />
            </div>
          </div>

          <div class="flex flex-col items-start">
            <span class="text-xs font-bold text-slate-900"
              >{{ Math.round(progressPercentage) }}%</span
            >
            <span class="text-[10px] text-slate-500">{{ statusText }}</span>
          </div>
        </button>
      </template>

      <template #content>
        <div class="w-72 p-4">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-sm font-bold text-slate-900">Upload Progress</h3>
            <span class="text-xs text-slate-500"
              >{{ progress?.complete || 0 }} / {{ progress?.total || 0 }}</span
            >
          </div>

          <div class="space-y-3">
            <!-- Compressing -->
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 text-slate-500">
                <div class="h-2 w-2 rounded-full bg-amber-400"></div>
                <span>Compressing</span>
              </div>
              <span class="font-medium text-slate-900">{{ progress?.compressing || 0 }}</span>
            </div>

            <!-- Uploading -->
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 text-slate-500">
                <div class="h-2 w-2 rounded-full bg-indigo-500"></div>
                <span>Uploading</span>
              </div>
              <span class="font-medium text-slate-900">{{ progress?.uploading || 0 }}</span>
            </div>

            <!-- Completed -->
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 text-slate-500">
                <div class="h-2 w-2 rounded-full bg-emerald-500"></div>
                <span>Completed</span>
              </div>
              <span class="font-medium text-slate-900">{{ progress?.complete || 0 }}</span>
            </div>

            <!-- Failed -->
            <div v-if="progress?.failed" class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 text-slate-500">
                <div class="h-2 w-2 rounded-full bg-red-500"></div>
                <span>Failed</span>
              </div>
              <span class="font-medium text-red-500">{{ progress?.failed || 0 }}</span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
              :style="{ width: `${progressPercentage}%` }"
            ></div>
          </div>
        </div>
      </template>
    </Dropdown>
  </div>
</template>
