<script setup lang="ts"></script>

<template>
  <div
    class="min-h-screen w-full bg-[#0f0f13] flex items-center justify-center relative overflow-hidden font-sans"
  >
    <!-- Ambient Background -->
    <div class="absolute inset-0 z-0">
      <div
        class="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"
      ></div>
      <div
        class="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-purple-600/20 rounded-full blur-[100px]"
      ></div>
      <div
        class="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-pink-600/20 rounded-full blur-[100px]"
      ></div>
    </div>

    <!-- Content -->
    <div class="relative z-10 w-full max-w-md p-4">
      <div class="glass-card p-8 rounded-2xl border border-white/10 shadow-2xl">
        <div class="flex justify-center mb-8">
          <div
            class="w-12 h-12 rounded-xl bg-gradient-to-br from-[#2DD4BF] to-[#14B8A6] flex items-center justify-center shadow-[0_0_20px_rgba(45,212,191,0.4)]"
          >
            <svg class="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
        </div>
        <slot />
      </div>

      <div class="mt-8 text-center">
        <p class="text-sm text-gray-500">
          &copy; {{ new Date().getFullYear() }} LumoSnap. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.glass-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01));
  backdrop-filter: blur(20px);
}
</style>
