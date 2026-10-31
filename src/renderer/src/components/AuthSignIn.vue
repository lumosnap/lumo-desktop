<script setup lang="ts">
// Browser sign-in plus the device-code fallback, shared by the login screen and the setup wizard.
import { ref, computed, onBeforeUnmount } from 'vue'
import { ExternalLink, Copy, Check, CircleAlert } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import { useNetworkStore } from '../stores/network'

const emit = defineEmits<{ done: [] }>()
const authStore = useAuthStore()
const networkStore = useNetworkStore()

type DeviceAuthData = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresAt: number
  interval: number
}

const deviceAuth = ref<DeviceAuthData | null>(null)
const deviceAuthError = ref<string | null>(null)
const codeCopied = ref(false)
const now = ref(Date.now())
let stopDevicePolling = false
let copyResetTimer: ReturnType<typeof setTimeout> | undefined
const clock = setInterval(() => (now.value = Date.now()), 1000)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const minutesLeft = computed(() =>
  deviceAuth.value ? Math.max(1, Math.ceil((deviceAuth.value.expiresAt - now.value) / 60000)) : 0
)
const verifyLabel = computed(
  () => deviceAuth.value?.verificationUri.replace(/^https?:\/\//, '') ?? ''
)
const errorText = computed(() =>
  authStore.error === 'Device authorization timed out'
    ? "Sign-in didn't finish. The code expired. Start again for a new one."
    : authStore.error
)

async function copyDeviceCode(): Promise<void> {
  if (!deviceAuth.value) return
  try {
    await navigator.clipboard.writeText(deviceAuth.value.userCode)
    codeCopied.value = true
    clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => (codeCopied.value = false), 1800)
  } catch {
    authStore.error = 'Could not copy code. Please copy it manually.'
  }
}

async function pollDeviceAuth(data: DeviceAuthData): Promise<void> {
  let pollInterval = Math.max(2, data.interval || 5)

  while (!stopDevicePolling && Date.now() < data.expiresAt) {
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

async function start(): Promise<void> {
  authStore.loading = true
  try {
    stopDevicePolling = false
    deviceAuth.value = null
    deviceAuthError.value = null
    authStore.error = null

    const authAttempts: Array<Promise<unknown>> = [authStore.startAuth()]

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
        verificationUriComplete:
          codeResult.verification_uri_complete || codeResult.verification_uri,
        expiresAt: Date.now() + codeResult.expires_in * 1000,
        interval: codeResult.interval || 5
      }
      authAttempts.push(pollDeviceAuth(deviceAuth.value))
    } else {
      deviceAuthError.value = codeResult.error || 'Device code unavailable'
    }

    await Promise.any(authAttempts)
    stopDevicePolling = true
    authStore.error = null
    emit('done')
  } catch (e) {
    console.error('Auth failed:', e)
    const errors = e instanceof AggregateError ? e.errors : [e]
    const firstMessage = errors.find((error) => error instanceof Error)?.message
    if (!authStore.error) {
      authStore.error = firstMessage || 'Authentication failed. Please try again.'
    }
  } finally {
    authStore.loading = false
  }
}

function cancel(): void {
  stopDevicePolling = true
  authStore.loading = false
  authStore.error = 'Authentication cancelled. You can try again.'
}

onBeforeUnmount(() => {
  stopDevicePolling = true
  clearInterval(clock)
  clearTimeout(copyResetTimer)
})
</script>

<template>
  <template v-if="authStore.loading">
    <div class="wait">
      <span class="spin brand"></span><span>Waiting for your browser…</span>
      <button class="link" style="margin-left: 8px; color: var(--ink-3)" @click="cancel">
        Cancel
      </button>
    </div>
    <div v-if="deviceAuth" class="code-card">
      <div class="top">
        <span>Browser didn't open? Use a code.</span>
        <span class="num">Expires in {{ minutesLeft }} min</span>
      </div>
      <div class="code">
        <span>{{ deviceAuth.userCode }}</span>
        <button class="btn sm ghost" @click="copyDeviceCode">
          <template v-if="codeCopied"><Check />Copied</template>
          <template v-else><Copy />Copy</template>
        </button>
      </div>
      <div class="how">
        Go to
        <a
          class="link"
          :href="deviceAuth.verificationUriComplete"
          target="_blank"
          rel="noopener noreferrer"
          >{{ verifyLabel }}</a
        >
        on any device and enter it
      </div>
    </div>
    <div v-else-if="deviceAuthError" class="err"><CircleAlert />{{ deviceAuthError }}</div>
  </template>
  <div v-else class="act">
    <button class="btn primary" :disabled="!networkStore.isOnline" @click="start">
      <ExternalLink />{{ networkStore.isOnline ? 'Sign in with browser' : 'Offline' }}
    </button>
  </div>
  <div v-if="errorText" class="err" role="alert"><CircleAlert />{{ errorText }}</div>
</template>
