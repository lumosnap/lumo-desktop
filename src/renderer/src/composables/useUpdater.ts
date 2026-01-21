import { ref, onMounted, onUnmounted } from 'vue'

export function useUpdater() {
  const updateStatus = ref<string>('')
  const updateAvailable = ref(false)

  let removeListener: (() => void) | null = null

  onMounted(() => {
    if (window.api && window.api.on) {
      removeListener = () => window.api.off('update-status', handleUpdateStatus)
      window.api.on('update-status', handleUpdateStatus)
    }
  })

  const handleUpdateStatus = (_event: any, message: string) => {
    updateStatus.value = message
    if (message.includes('Update available')) {
      updateAvailable.value = true
    }
  }

  onUnmounted(() => {
    if (removeListener) {
      removeListener()
    }
  })

  const checkForUpdates = () => {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('check-for-updates')
    }
  }

  return {
    updateStatus,
    updateAvailable,
    checkForUpdates
  }
}
