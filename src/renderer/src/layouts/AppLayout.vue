<script setup lang="ts">
import AppSidebar from '../components/AppSidebar.vue'
import FloatingNavbar from '../components/FloatingNavbar.vue'
</script>

<template>
  <div
    class="min-h-screen bg-[#0f0f13] font-sans text-gray-900 selection:bg-[#00E0C6] selection:text-white overflow-hidden"
  >
    <!-- Ambient Background Blobs -->
    <div class="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <!-- Turquoise/Blue Blob (Top Left) -->
      <div
        class="absolute -left-32 top-1/4 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-teal-500/40 to-blue-600/30 blur-[100px] animate-pulse-slow"
      ></div>

      <!-- Cyan/Emerald Blob (Bottom Right) -->
      <div
        class="absolute -left-20 bottom-0 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-cyan-500/30 to-emerald-400/20 blur-[80px]"
      ></div>

      <!-- Blue/Teal Blob (Top Right) -->
      <div
        class="absolute left-32 top-0 h-[300px] w-[300px] rounded-full bg-gradient-to-br from-blue-500/20 to-teal-400/20 blur-[60px]"
      ></div>
    </div>

    <AppSidebar />
    <FloatingNavbar />

    <!-- Main Content Area -->
    <main class="ml-[280px] min-h-screen relative z-10 p-4 pl-0">
      <div
        class="h-[calc(100vh-2rem)] bg-[#f5f6f7] rounded-l-[24px] shadow-[-4px_0_24px_rgba(0,0,0,0.2)] overflow-hidden relative"
      >
        <div class="h-full overflow-y-auto custom-scrollbar">
          <slot />
        </div>
      </div>
    </main>
  </div>
</template>

<style>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 20px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
}
</style>
