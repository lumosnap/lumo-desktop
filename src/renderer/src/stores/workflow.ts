import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface WorkflowImage {
  id: number
  originalFilename: string
  localFilePath: string
  localNotes: string | null
  localTodoStatus: 'normal' | 'needs-work' | 'working' | 'done' | null
  albumId: string
  albumTitle?: string
  updatedAt?: string
  width?: number
  height?: number
}

export const useWorkflowStore = defineStore('workflow', () => {
  // State
  const images = ref<WorkflowImage[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  
  // Filters
  const selectedAlbumId = ref<string>('all')
  const showDone = ref(false)
  const searchQuery = ref('')
  
  // Pagination
  const limit = ref(20)

  // Getters
  const filteredImages = computed(() => {
    let result = images.value

    // 1. Filter by Album
    if (selectedAlbumId.value !== 'all') {
      result = result.filter(img => img.albumId === selectedAlbumId.value)
    }

    // 2. Filter by Status
    result = result.filter(img => {
      const status = img.localTodoStatus
      if (!status || status === 'normal') return false
      if (status === 'done' && !showDone.value) return false
      return true
    })

    // 3. Search
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      result = result.filter(img => 
        img.originalFilename.toLowerCase().includes(query) ||
        (img.localNotes && img.localNotes.toLowerCase().includes(query)) ||
        (img.albumTitle && img.albumTitle.toLowerCase().includes(query))
      )
    }

    return result
  })

  const displayedImages = computed(() => {
    return filteredImages.value.slice(0, limit.value)
  })

  const hasMore = computed(() => {
    return filteredImages.value.length > limit.value
  })

  // Actions
  function loadMore() {
    limit.value += 20
  }

  async function fetchWorkflowData(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // Fetch albums and workflow images in parallel
      const [albumsResult, workflowResult] = await Promise.all([
        window.api.albums.list(),
        window.api.albums.getWorkflowImages()
      ])

      // Handle albums result (mostly for side effects/caching if needed by other stores, 
      // though here we just ensure they are loaded for the filter)
      if (!albumsResult.success) {
        console.warn('Failed to fetch albums list:', albumsResult.error)
      }

      // Handle workflow images result
      if (workflowResult.success) {
        images.value = workflowResult.images
      } else {
        throw new Error(workflowResult.error || 'Failed to fetch workflow images')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load data'
      console.error('Failed to load workflow data:', err)
      error.value = message
    } finally {
      loading.value = false
    }
  }

  async function updateStatus(image: WorkflowImage, status: 'normal' | 'needs-work' | 'working' | 'done') {
    try {
      const result = await window.api.albums.updateImageLocalData({
        imageId: image.id,
        localTodoStatus: status
      })
      if (result.success) {
        // Update local state
        const target = images.value.find(img => img.id === image.id)
        if (target) {
          target.localTodoStatus = status
        }
      }
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  async function updateNotes(image: WorkflowImage, notes: string) {
    try {
      const result = await window.api.albums.updateImageLocalData({
        imageId: image.id,
        localNotes: notes
      })
      if (result.success) {
        // Update local state
        const target = images.value.find(img => img.id === image.id)
        if (target) {
          target.localNotes = notes
        }
      }
    } catch (err) {
      console.error('Failed to update notes:', err)
    }
  }

  return {
    // State
    images,
    loading,
    error,
    selectedAlbumId,
    showDone,
    searchQuery,
    limit,
    
    // Getters
    filteredImages,
    displayedImages,
    hasMore,
    
    // Actions
    loadMore,
    fetchWorkflowData,
    updateStatus,
    updateNotes
  }
})
