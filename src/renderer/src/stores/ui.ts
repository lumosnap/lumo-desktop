import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUIStore = defineStore('ui', () => {
  const selectedDate = ref(new Date())

  const selectedAlbumId = ref<string | null>(null)

  function setSelectedDate(date: Date): void {
    selectedDate.value = date
  }

  function setSelectedAlbumId(id: string | null): void {
    selectedAlbumId.value = id
  }

  return {
    selectedDate,
    selectedAlbumId,
    setSelectedDate,
    setSelectedAlbumId
  }
})
