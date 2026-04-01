<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { Cloud, Image, ExternalLink, Loader2, Copy, Check } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

type DeviceAuthData = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

const deviceAuth = ref<DeviceAuthData | null>(null)
const deviceAuthError = ref<string | null>(null)
const stopDevicePolling = ref(false)
const codeCopied = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const formatExpiry = (seconds: number): string => `${Math.max(1, Math.round(seconds / 60))} min`

const copyDeviceCode = async (): Promise<void> => {
  if (!deviceAuth.value?.userCode) return

  const text = deviceAuth.value.userCode
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const input = document.createElement('textarea')
      input.value = text
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.focus()
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    codeCopied.value = true
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      codeCopied.value = false
    }, 1800)
  } catch {
    authStore.error = 'Could not copy code. Please copy it manually.'
  }
}

const pollDeviceAuth = async (data: DeviceAuthData): Promise<void> => {
  let pollInterval = Math.max(2, data.interval || 5)
  const expiryAt = Date.now() + data.expiresIn * 1000

  while (!stopDevicePolling.value && Date.now() < expiryAt) {
    const result = await window.api.auth.pollDeviceToken(data.deviceCode)

    if (result.success) {
      await authStore.checkSession()
      return
    }

    if (result.pending) {
      if (result.interval) {
        pollInterval = Math.max(2, result.interval)
      } else if (result.error === 'slow_down') {
        pollInterval += 2
      }
      await sleep(pollInterval * 1000)
      continue
    }

    throw new Error(result.error_description || result.error || 'Device authorization failed')
  }

  throw new Error('Device authorization timed out')
}

const handleConnect = async (): Promise<void> => {
  authStore.loading = true
  try {
    stopDevicePolling.value = false
    authStore.error = null
    deviceAuthError.value = null
    deviceAuth.value = null

    const codeResult = await window.api.auth.requestDeviceCode()
    if (
      codeResult.success &&
      codeResult.device_code &&
      codeResult.user_code &&
      codeResult.verification_uri &&
      codeResult.expires_in
    ) {
      deviceAuth.value = {
        deviceCode: codeResult.device_code,
        userCode: codeResult.user_code,
        verificationUri: codeResult.verification_uri,
        verificationUriComplete: codeResult.verification_uri_complete || codeResult.verification_uri,
        expiresIn: codeResult.expires_in,
        interval: codeResult.interval || 5
      }
    } else {
      throw new Error(codeResult.error || 'Device code unavailable')
    }

    if (!deviceAuth.value) {
      throw new Error('Device code unavailable')
    }
    await pollDeviceAuth(deviceAuth.value)
    router.push('/albums')
  } catch (e: unknown) {
    console.error('Auth failed:', e)
    const message = e instanceof Error ? e.message : 'Authentication failed. Please try again.'
    authStore.error = message
    deviceAuthError.value = message
  } finally {
    authStore.loading = false
  }
}

const handleCancel = (): void => {
  stopDevicePolling.value = true
  authStore.loading = false
  authStore.error = 'Authentication cancelled. You can try again.'
}

onBeforeUnmount(() => {
  stopDevicePolling.value = true
  if (copyResetTimer) {
    clearTimeout(copyResetTimer)
    copyResetTimer = null
  }
})
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
        <div class="content-scroll">
          <div class="text-container">
            <span class="step-indicator">Welcome Back</span>
            <h1>Connect to Cloud</h1>
            <p>
              Sign in to your LumoSnap account to access your albums and continue where you left
              off.
            </p>
          </div>

          <!-- Dynamic Content Area -->
          <div class="dynamic-area">
            <!-- Loading State -->
            <div v-if="authStore.loading" class="auth-waiting">
              <div class="waiting-box">
                <Loader2 class="animate-spin" :size="20" />
                <span>Waiting for device authorization...</span>
              </div>
              <button class="btn-cancel" @click="handleCancel">Cancel</button>
              <p class="hint-text">We are listening for approval. If needed, use the manual code below.</p>

              <div v-if="deviceAuth" class="auth-divider"><span>OR</span></div>

              <div v-if="deviceAuth" class="device-auth-box">
                <div class="device-auth-topline">
                  <span class="device-auth-kicker">Alternate Sign-In</span>
                  <span class="device-auth-expiry">Expires in {{ formatExpiry(deviceAuth.expiresIn) }}</span>
                </div>
                <div class="device-auth-head">
                  <div>
                    <p class="device-auth-title">Use this device code</p>
                    <p class="device-auth-caption">Open the verification page, paste the code, and come back here.</p>
                  </div>
                  <button class="copy-code-btn" type="button" @click="copyDeviceCode">
                    <Check v-if="codeCopied" :size="14" />
                    <Copy v-else :size="14" />
                    <span>{{ codeCopied ? 'Copied' : 'Copy code' }}</span>
                  </button>
                </div>
                <div class="device-auth-actions">
                  <div class="device-auth-code-wrap">
                    <div class="device-auth-code">{{ deviceAuth.userCode }}</div>
                  </div>
                  <a
                    class="device-open-btn"
                    :href="deviceAuth.verificationUriComplete"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Verification Page
                  </a>
                </div>
                <div class="device-link-wrap">
                  <span class="device-link-label">Verification URL</span>
                  <a
                    class="device-auth-link"
                    :href="deviceAuth.verificationUriComplete"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ deviceAuth.verificationUriComplete }}
                  </a>
                </div>
              </div>
              <div v-if="deviceAuthError" class="device-auth-error">{{ deviceAuthError }}</div>
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
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  user-select: none;
  padding: 24px;
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
  max-width: min(800px, 100%);
  min-height: 520px;
  max-height: calc(100vh - 48px);
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
  min-width: 0;
  padding: 40px 32px 28px;
  display: flex;
  flex-direction: column;
  background: white;
  overflow: hidden;
}

.content-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 6px;
  display: flex;
  flex-direction: column;
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
  font-size: 32px;
  font-weight: 700;
  color: var(--zinc-900);
  margin-bottom: 14px;
  letter-spacing: -0.8px;
}

p {
  font-size: 15px;
  color: var(--zinc-500);
  line-height: 1.5;
  margin-bottom: 20px;
}

/* Dynamic Area */
.dynamic-area {
  margin-bottom: 18px;
}

/* Auth States */
.auth-waiting {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.waiting-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  background: var(--zinc-100);
  border: 1px solid rgba(0, 0, 0, 0.03);
  border-radius: 16px;
  color: var(--zinc-500);
  font-weight: 600;
  font-size: 15px;
}

.btn-cancel {
  align-self: center;
  padding: 8px 14px;
  background: transparent;
  border: none;
  color: var(--zinc-400);
  font-size: 13px;
  font-weight: 600;
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
  max-width: 320px;
  align-self: center;
  line-height: 1.45;
}

.auth-divider {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 6px 0 2px;
}

.auth-divider::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--zinc-200), transparent);
}

.auth-divider span {
  position: relative;
  z-index: 1;
  padding: 0 12px;
  background: white;
  color: var(--zinc-400);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.8px;
}

.device-auth-box {
  padding: 16px;
  border: 1px solid rgba(124, 58, 237, 0.12);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(245, 243, 255, 0.68) 0%, rgba(255, 255, 255, 0.98) 100%),
    white;
  box-shadow:
    0 18px 40px -32px rgba(124, 58, 237, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.device-auth-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  letter-spacing: 0.7px;
  text-transform: uppercase;
}

.device-auth-kicker {
  color: var(--violet-600);
  font-weight: 700;
}

.device-auth-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.device-auth-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
  color: var(--zinc-900);
}

.device-auth-caption {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--zinc-500);
}

.copy-code-btn {
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(124, 58, 237, 0.16);
  background: white;
  color: var(--zinc-700);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
}

.copy-code-btn:hover {
  border-color: var(--violet-400);
  color: var(--violet-600);
  box-shadow: 0 10px 20px -18px rgba(124, 58, 237, 0.45);
}

.device-auth-actions {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.device-auth-code-wrap {
  flex: 1;
  border-radius: 16px;
  border: 1px solid rgba(124, 58, 237, 0.12);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.85) 0%, rgba(244, 244, 245, 0.9) 100%);
  padding: 16px;
}

.device-auth-code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--zinc-900);
  text-align: center;
  line-height: 1;
}

.device-open-btn {
  min-width: 148px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--violet-600), var(--violet-500));
  color: white;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 14px 16px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
  box-shadow: 0 18px 28px -22px rgba(124, 58, 237, 0.65);
}

.device-open-btn:hover {
  filter: brightness(1.03);
}

.device-link-wrap {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.device-link-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--zinc-400);
}

.device-auth-link {
  font-size: 12px;
  color: var(--violet-600);
  text-decoration: none;
  word-break: break-word;
  line-height: 1.45;
}

.device-auth-link:hover {
  text-decoration: underline;
}

.device-auth-expiry {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--zinc-400);
  white-space: nowrap;
}

.device-auth-error {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  font-size: 12px;
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
  margin-top: 24px;
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

@media (max-width: 860px) {
  .login-container {
    padding: 16px;
    overflow: auto;
  }

  .window-frame {
    min-height: 0;
    max-height: none;
    flex-direction: column;
  }

  .visual-pane {
    width: 100%;
    min-height: 180px;
    border-right: none;
    border-bottom: 1px solid var(--zinc-200);
  }

  .content-pane {
    padding: 28px 22px 22px;
  }

  .device-auth-head,
  .device-auth-topline,
  .device-auth-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .copy-code-btn,
  .device-open-btn {
    width: 100%;
  }

  .device-auth-code {
    font-size: 24px;
    letter-spacing: 3px;
  }
}
</style>
