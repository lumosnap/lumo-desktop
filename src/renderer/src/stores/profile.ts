import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { currentPlanOf } from '../utils/format'

interface ProfileData {
  id: number
  userId: string | null
  businessName: string | null
  phone: string | null
  storageUsed: number | null
  totalImages: number
  globalMaxImages: number
  imageLimit: number
  planName: string
  planExpiry: string | null
  profileCompleted: boolean
  createdAt: string
  updatedAt: string
}

export interface Plan {
  id: number
  name: string
  displayName: string
  imageLimit: number
  priceMonthly: string
  description: string
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

  // The plans on sale, so the plan is called by one name everywhere: with no subscription the
  // worker says "Trial", while the plans list calls that free plan "Starter"
  const plans = ref<Plan[]>([])
  const currentPlan = computed(() => currentPlanOf(plans.value, profile.value))
  const planName = computed(() => currentPlan.value?.displayName ?? profile.value?.planName ?? null)
  async function loadPlans(): Promise<void> {
    try {
      const result = await window.api.plans.list()
      if (result.success && result.data) plans.value = result.data
    } catch (err: unknown) {
      console.error('Failed to load plans:', err)
    }
  }

  // Computed: is user near their image limit (>80%)
  const isNearLimit = computed(() => {
    if (!profile.value) return false
    const usage = profile.value.totalImages / profile.value.imageLimit
    return usage >= 0.8 && usage < 1
  })

  // Computed: is user at or over their image limit
  const isAtLimit = computed(() => {
    if (!profile.value) return false
    return profile.value.totalImages >= profile.value.imageLimit
  })

  // Computed: remaining images that can be uploaded
  const remainingImages = computed(() => {
    if (!profile.value) return 0
    return Math.max(0, profile.value.imageLimit - profile.value.totalImages)
  })

  // Computed: usage percentage for progress bars
  const usagePercentage = computed(() => {
    if (!profile.value) return 0
    return Math.min((profile.value.totalImages / profile.value.imageLimit) * 100, 100)
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
    if (!plans.value.length) loadPlans()

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
    isNearLimit,
    isAtLimit,
    remainingImages,
    usagePercentage,
    plans,
    currentPlan,
    planName,
    loadPlans,
    fetchProfile,
    updateProfile,
    clearProfile
  }
})
