import { ref, type Ref } from 'vue'
import { useAuthStore } from '../stores/auth'

// Booking link, cached per account in localStorage. Shared by Bookings and Settings.
export function useBookingUrl(): {
  url: Ref<string>
  loading: Ref<boolean>
  error: Ref<string | null>
  copied: Ref<boolean>
  load: () => Promise<boolean>
  copy: () => Promise<void>
  open: () => void
} {
  const authStore = useAuthStore()
  const url = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const copied = ref(false)

  async function load(): Promise<boolean> {
    if (url.value) return true
    const key = `bookingUrl_${authStore.user?.email || 'default'}`
    const cached = localStorage.getItem(key)
    if (cached) {
      url.value = cached
      return true
    }
    loading.value = true
    error.value = null
    try {
      const result = await window.api.profile.getBookingUrl()
      if (result.success && result.bookingUrl) {
        url.value = result.bookingUrl
        localStorage.setItem(key, result.bookingUrl)
        return true
      }
      error.value = result.error || 'Failed to generate booking URL'
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to generate booking URL'
    } finally {
      loading.value = false
    }
    return false
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url.value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url.value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  }

  function open(): void {
    window.open(url.value, '_blank')
  }

  return { url, loading, error, copied, load, copy, open }
}
