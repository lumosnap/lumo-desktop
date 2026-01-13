<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import {
  Aperture,
  Cloud,
  Image,
  FolderOpen,
  Folder,
  Search,
  Zap,
  ArrowRight,
  Loader2,
  ExternalLink
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const currentStep = ref(0)
const selectedFolder = ref<string | null>(null)
const isSelectingFolder = ref(false)

const steps = [
  {
    step: 'Introduction',
    title: 'Welcome to LumoSnap',
    desc: "The professional's choice for asset curation. We're going to set up your local database and sync your preferences.",
    btn: 'Get Started',
    progress: 10
  },
  {
    step: 'Synchronization',
    title: 'Connect to Cloud',
    desc: 'Sign in to your LumoSnap account to sync your albums and settings across devices.',
    btn: 'Connect to LumoSnap',
    progress: 45
  },
  {
    step: 'Optimization',
    title: 'Watch Folder',
    desc: "Where should LumoSnap watch for new images? We'll automatically import and optimize photos added here.",
    btn: 'Confirm Folder',
    progress: 80
  },
  {
    step: 'Complete',
    title: "You're All Set!",
    desc: 'LumoSnap has been successfully configured. Your workspace is ready.',
    btn: 'Launch LumoSnap',
    progress: 100
  }
]

const currentStepData = computed(() => steps[currentStep.value])
const isNextDisabled = computed(() => {
  if (currentStep.value === 1 && authStore.loading) return true
  if (currentStep.value === 2 && !selectedFolder.value) return true
  return false
})

async function handleNext(): Promise<void> {
  if (currentStep.value === 1) {
    // Connect step - start auth
    try {
      await authStore.startAuth()
      currentStep.value++
    } catch (e) {
      console.error('Auth failed:', e)
    }
  } else if (currentStep.value === 2) {
    // Folder step - save master folder
    if (selectedFolder.value) {
      await window.api.config.setMasterFolder(selectedFolder.value)
      currentStep.value++
    }
  } else if (currentStep.value === 3) {
    // Complete - launch app
    router.push('/albums')
  } else {
    currentStep.value++
  }
}

async function selectFolder(): Promise<void> {
  isSelectingFolder.value = true
  try {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      selectedFolder.value = path
    }
  } finally {
    isSelectingFolder.value = false
  }
}

function handleCancel(): void {
  authStore.loading = false
  authStore.error = 'Authentication cancelled. You can try again.'
}
</script>

<template>
  <div class="setup-container">
    <!-- Ambient Background -->
    <div class="ambient-bg">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
    </div>

    <!-- Window Frame -->
    <div class="window-frame">
      <!-- Left: Visual Pane -->
      <div class="visual-pane">
        <!-- Step 0: Welcome -->
        <div class="stage-visual" :class="{ active: currentStep === 0 }">
          <div class="logo-stack">
            <Aperture :size="60" />
          </div>
        </div>

        <!-- Step 1: Connect -->
        <div class="stage-visual v-sync" :class="{ active: currentStep === 1 }">
          <div class="cloud-base">
            <Cloud :size="80" :stroke-width="1.5" />
            <div class="file-icon f1"><Image :size="16" /></div>
            <div class="file-icon f2"><Image :size="16" /></div>
            <div class="file-icon f3"><Image :size="16" /></div>
          </div>
        </div>

        <!-- Step 2: Folder -->
        <div class="stage-visual" :class="{ active: currentStep === 2 }">
          <div class="folder-viz">
            <FolderOpen :size="48" class="text-zinc-400" />
            <div class="search-beam">
              <Search :size="24" />
            </div>
          </div>
        </div>

        <!-- Step 3: Complete -->
        <div class="stage-visual" :class="{ active: currentStep === 3 }">
          <div class="delight-container">
            <div class="confetti c1"></div>
            <div class="confetti c2"></div>
            <div class="confetti c3"></div>
            <div class="confetti c4"></div>
            <div class="launch-pass">
              <div class="pass-icon">
                <Zap :size="32" fill="white" />
              </div>
              <h3>Ready to Create</h3>
              <p>Your workspace is optimized<br />and ready for takeoff.</p>
              <div class="pass-code">
                <span>LUMO-8X29-PASS</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Content Pane -->
      <div class="content-pane">
        <div :key="currentStep" class="text-container">
          <span class="step-indicator">{{ currentStepData.step }}</span>
          <h1>{{ currentStepData.title }}</h1>
          <p>{{ currentStepData.desc }}</p>
        </div>

        <div>
          <!-- Dynamic Content Area -->
          <div class="dynamic-area">
            <!-- Step 1: Auth Loading State -->
            <div v-if="currentStep === 1 && authStore.loading" class="auth-waiting">
              <div class="waiting-box">
                <Loader2 class="animate-spin" :size="20" />
                <span>Waiting for browser authentication...</span>
              </div>
              <button class="btn-cancel" @click="handleCancel">Cancel</button>
              <p class="hint-text">Complete the sign-in in your browser, then return here.</p>
            </div>

            <!-- Step 1: Error State -->
            <div v-if="currentStep === 1 && authStore.error" class="error-box">
              {{ authStore.error }}
            </div>

            <!-- Step 2: Folder Picker -->
            <div v-if="currentStep === 2" class="folder-select-ui" @click="selectFolder">
              <div class="folder-icon-box">
                <Folder :size="16" />
              </div>
              <div class="folder-text">
                {{
                  isSelectingFolder ? 'Scanning...' : selectedFolder || 'Select a Watch Folder...'
                }}
              </div>
              <div class="folder-action">Change</div>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="progress-container">
            <div class="progress-fill" :style="{ width: `${currentStepData.progress}%` }"></div>
          </div>

          <!-- Button Group -->
          <div class="btn-group">
            <button
              class="btn btn-primary"
              :class="{ disabled: isNextDisabled }"
              :disabled="isNextDisabled"
              @click="handleNext"
            >
              <template v-if="currentStep === 1 && !authStore.loading">
                <ExternalLink :size="16" />
              </template>
              <span>{{ currentStepData.btn }}</span>
              <ArrowRight
                v-if="currentStep !== 3 && !(currentStep === 1 && !authStore.loading)"
                :size="16"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* CSS Variables */
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
}

.setup-container {
  --zinc-900: #18181b;
  --zinc-800: #27272a;
  --zinc-500: #71717a;
  --zinc-400: #a1a1aa;
  --zinc-300: #d4d4d8;
  --zinc-200: #e4e4e7;
  --zinc-100: #f4f4f5;
  --violet-600: #7c3aed;
  --violet-500: #8b5cf6;
  --violet-400: #a78bfa;
  --violet-300: #c4b5fd;
  --violet-100: #ede9fe;
  --violet-50: #f5f3ff;
  --indigo-600: #4f46e5;
  --indigo-400: #818cf8;
  --white: #ffffff;

  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--zinc-900);
  background: #f0f2f5;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  user-select: none;
}

/* Ambient Background */
.ambient-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.6;
  animation: float 10s ease-in-out infinite alternate;
}

.orb-1 {
  top: -10%;
  left: -10%;
  width: 50vw;
  height: 50vw;
  background: #e0e7ff;
}

.orb-2 {
  bottom: -10%;
  right: -10%;
  width: 50vw;
  height: 50vw;
  background: #f5f3ff;
  animation-delay: -5s;
}

/* Window Frame */
.window-frame {
  position: relative;
  z-index: 10;
  width: 800px;
  height: 520px;
  background: var(--white);
  border-radius: 12px;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.04),
    0 20px 50px -10px rgba(0, 0, 0, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.5) inset;
  display: flex;
  overflow: hidden;
  animation: popIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Visual Pane */
.visual-pane {
  width: 340px;
  background: var(--zinc-100);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-right: 1px solid var(--zinc-200);
}

.visual-pane::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, var(--violet-50) 0%, rgba(255, 255, 255, 0) 100%);
}

/* Content Pane */
.content-pane {
  flex: 1;
  padding: 48px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: white;
}

/* Stage Visuals */
.stage-visual {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.9);
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

.stage-visual.active {
  opacity: 1;
  transform: scale(1);
}

/* Welcome Logo */
.logo-stack {
  width: 120px;
  height: 120px;
  background: linear-gradient(135deg, var(--violet-600), var(--indigo-600));
  border-radius: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 20px 40px -10px rgba(124, 58, 237, 0.4);
  position: relative;
}

.logo-stack::after {
  content: '';
  position: absolute;
  inset: -12px;
  border: 1px solid rgba(124, 58, 237, 0.2);
  border-radius: 36px;
}

/* Cloud Sync Visual */
.cloud-base {
  width: 140px;
  height: 90px;
  color: var(--violet-500);
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
}

.file-icon {
  position: absolute;
  width: 32px;
  height: 40px;
  background: white;
  border: 1px solid var(--violet-100);
  border-radius: 6px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--violet-500);
  opacity: 0;
}

.f1 {
  animation: flyIn 2.5s infinite;
  top: 100px;
  left: -40px;
  --tx: 30px;
  --ty: -40px;
}

.f2 {
  animation: flyIn 2.5s infinite 0.8s;
  top: 120px;
  right: -40px;
  --tx: -30px;
  --ty: -50px;
}

.f3 {
  animation: flyIn 2.5s infinite 1.6s;
  top: 140px;
  left: 50%;
  transform: translateX(-50%);
  --tx: 0px;
  --ty: -40px;
}

/* Folder Visual */
.folder-viz {
  width: 140px;
  height: 100px;
  background: white;
  border: 1px solid var(--zinc-200);
  border-radius: 12px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 15px 30px -5px rgba(0, 0, 0, 0.1);
}

.text-zinc-400 {
  color: var(--zinc-400);
}

.search-beam {
  position: absolute;
  top: -20%;
  right: -20%;
  width: 60px;
  height: 60px;
  background: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--violet-600);
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.05);
  animation: float 4s ease-in-out infinite;
}

/* Success Visual */
.delight-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.launch-pass {
  width: 220px;
  height: 320px;
  background: linear-gradient(135deg, #ffffff, #fdf4ff);
  border-radius: 20px;
  box-shadow: 0 20px 50px -10px rgba(124, 58, 237, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 20px;
  position: relative;
  overflow: hidden;
  animation: slideUpFade 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.launch-pass::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 6px;
  background: linear-gradient(90deg, var(--violet-500), var(--indigo-600));
}

.pass-icon {
  margin-bottom: 20px;
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, var(--violet-600), var(--indigo-600));
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 10px 20px rgba(79, 70, 229, 0.3);
}

.launch-pass h3 {
  font-size: 18px;
  font-weight: 800;
  color: var(--zinc-900);
  margin-bottom: 8px;
}

.launch-pass p {
  font-size: 13px;
  color: var(--zinc-500);
  line-height: 1.4;
  margin: 0;
}

.pass-code {
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px dashed var(--zinc-200);
  width: 100%;
}

.pass-code span {
  font-family: monospace;
  font-size: 11px;
  color: var(--zinc-400);
  letter-spacing: 1px;
}

/* Confetti */
.confetti {
  position: absolute;
  width: 8px;
  height: 8px;
  background: var(--violet-400);
  border-radius: 50%;
  opacity: 0;
}

.c1 {
  top: 20%;
  left: 20%;
  animation: pop 1s ease-out forwards 0.5s;
  background: var(--indigo-400);
}

.c2 {
  top: 30%;
  right: 25%;
  animation: pop 1s ease-out forwards 0.7s;
  background: #ec4899;
}

.c3 {
  bottom: 40%;
  left: 15%;
  animation: pop 1s ease-out forwards 0.6s;
  background: #fbbf24;
}

.c4 {
  bottom: 25%;
  right: 20%;
  animation: pop 1s ease-out forwards 0.8s;
  background: var(--violet-500);
}

/* Typography */
.text-container {
  animation: fadeIn 0.4s ease-out;
}

.step-indicator {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--violet-600);
  margin-bottom: 8px;
  display: block;
}

h1 {
  font-size: 28px;
  font-weight: 700;
  color: var(--zinc-900);
  margin-bottom: 12px;
  letter-spacing: -0.5px;
}

p {
  font-size: 15px;
  color: var(--zinc-500);
  line-height: 1.5;
  margin-bottom: 24px;
}

/* Dynamic Area */
.dynamic-area {
  min-height: 50px;
  margin-bottom: 20px;
}

/* Auth States */
.auth-waiting {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.waiting-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--zinc-100);
  border-radius: 8px;
  color: var(--zinc-500);
  font-weight: 500;
}

.btn-cancel {
  padding: 12px;
  background: transparent;
  border: none;
  color: var(--zinc-400);
  font-size: 14px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s;
}

.btn-cancel:hover {
  color: var(--zinc-900);
  background: var(--zinc-100);
}

.hint-text {
  font-size: 12px;
  color: var(--zinc-400);
  text-align: center;
  margin: 0;
}

.error-box {
  padding: 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
  color: #ef4444;
  font-size: 14px;
  text-align: center;
}

/* Folder Select */
.folder-select-ui {
  background: var(--zinc-100);
  border: 1px solid var(--zinc-200);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.folder-select-ui:hover {
  border-color: var(--violet-500);
  background: white;
}

.folder-icon-box {
  width: 32px;
  height: 32px;
  background: var(--violet-100);
  color: var(--violet-600);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.folder-text {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--zinc-800);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-action {
  font-size: 12px;
  font-weight: 600;
  color: var(--violet-600);
}

/* Progress */
.progress-container {
  width: 100%;
  height: 4px;
  background: var(--zinc-100);
  border-radius: 2px;
  overflow: hidden;
  margin-top: auto;
}

.progress-fill {
  height: 100%;
  background: var(--zinc-900);
  transition: width 0.4s ease-out;
  border-radius: 2px;
}

/* Buttons */
.btn-group {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn-primary {
  background: var(--zinc-900);
  color: white;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.btn-primary:hover:not(.disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}

.btn-primary:active:not(.disabled) {
  transform: translateY(0);
}

.btn-primary.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Animations */
@keyframes popIn {
  0% {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes float {
  0% {
    transform: translate(0, 0);
  }
  100% {
    transform: translate(20px, 20px);
  }
}

@keyframes slideUpFade {
  0% {
    transform: translateY(20px);
    opacity: 0;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes flyIn {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.5);
  }
  20% {
    opacity: 1;
    transform: translate(var(--tx), var(--ty)) scale(1);
  }
  80% {
    opacity: 1;
    transform: translate(0, -60px) scale(0.8);
  }
  100% {
    opacity: 0;
    transform: translate(0, -70px) scale(0);
  }
}

@keyframes pop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}
</style>
