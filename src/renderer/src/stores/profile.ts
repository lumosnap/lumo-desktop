import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface ProfileData {
  id: number
  userId: string | null
  businessName: string | null
  phone: string | null
  storageUsed: number | null
  totalImages?: number
  globalMaxImages?: number
  createdAt: string
  updatedAt: string
}

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<ProfileData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const hasFetched = ref(false)

  // Computed display name: business name or fallback
  const displayName = computed(() => {
    if (profile.value?.businessName) {
      return profile.value.businessName
    }
    return null // Let the component handle fallback
  })

  /**
   * Fetch profile from API (only if not already fetched)
   */
  async function fetchProfile(force = false): Promise<void> {
    if (hasFetched.value && !force) {
      return
    }

    loading.value = true
    error.value = null

    try {
      const result = await window.api.profile.get()
      if (result.success && result.data) {
        profile.value = result.data
        hasFetched.value = true
      } else {
        error.value = result.error || 'Failed to fetch profile'
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch profile'
    } finally {
      loading.value = false
    }
  }

  /**
   * Update profile and refresh local data
   */
  async function updateProfile(data: { businessName?: string; phone?: string }): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const result = await window.api.profile.update(data)
      if (result.success && result.data) {
        profile.value = result.data
        return true
      } else {
        error.value = result.error || 'Failed to update profile'
        return false
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to update profile'
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Clear profile data (on logout)
   */
  function clearProfile(): void {
    profile.value = null
    hasFetched.value = false
    error.value = null
  }

  return {
    profile,
    loading,
    error,
    displayName,
    hasFetched,
    fetchProfile,
    updateProfile,
    clearProfile
  }
})
