<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { Cloud, Image, ExternalLink, Loader2 } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const handleConnect = async (): Promise<void> => {
  try {
    await authStore.startAuth()
    router.push('/albums')
  } catch (e: unknown) {
    console.error('Auth failed:', e)
  }
}

const handleCancel = (): void => {
  authStore.loading = false
  authStore.error = 'Authentication cancelled. You can try again.'
}
</script>

<template>
  <div class="login-container">
    <!-- Ambient Background -->
    <div class="ambient-bg">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
    </div>

    <!-- Window Frame -->
    <div class="window-frame">
      <!-- Left: Visual Pane -->
      <div class="visual-pane">
        <div class="cloud-base">
          <Cloud :size="80" :stroke-width="1.5" />
          <div class="file-icon f1"><Image :size="16" /></div>
          <div class="file-icon f2"><Image :size="16" /></div>
          <div class="file-icon f3"><Image :size="16" /></div>
        </div>
      </div>

      <!-- Right: Content Pane -->
      <div class="content-pane">
        <div class="text-container">
          <span class="step-indicator">Welcome Back</span>
          <h1>Connect to Cloud</h1>
          <p>
            Sign in to your LumoSnap account to access your albums and continue where you left off.
          </p>
        </div>

        <div>
          <!-- Dynamic Content Area -->
          <div class="dynamic-area">
            <!-- Loading State -->
            <div v-if="authStore.loading" class="auth-waiting">
              <div class="waiting-box">
                <Loader2 class="animate-spin" :size="20" />
                <span>Waiting for browser authentication...</span>
              </div>
              <button class="btn-cancel" @click="handleCancel">Cancel</button>
              <p class="hint-text">Complete the sign-in in your browser, then return here.</p>
            </div>

            <!-- Error State -->
            <div v-if="authStore.error" class="error-box">
              {{ authStore.error }}
            </div>
          </div>

          <!-- Progress Bar (static for login) -->
          <div class="progress-container">
            <div class="progress-fill" style="width: 100%"></div>
          </div>

          <!-- Button Group -->
          <div class="btn-group">
            <button v-if="!authStore.loading" class="btn btn-primary" @click="handleConnect">
              <ExternalLink :size="16" />
              <span>Connect to LumoSnap</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-container {
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
  --violet-100: #ede9fe;
  --violet-50: #f5f3ff;
  --indigo-600: #4f46e5;
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

/* Cloud Visual */
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

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}

.btn-primary:active {
  transform: translateY(0);
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

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
