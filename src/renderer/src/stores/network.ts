/**
 * Network Store for LumoSnap Desktop
 *
 * Manages network connectivity state in the renderer process.
 * Subscribes to network status changes from the main process.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useNetworkStore = defineStore('network', () => {
  const isOnline = ref(true)
  const checking = ref(false)

  // Cleanup function for the listener
  let unsubscribe: (() => void) | null = null

  /**
   * Check current network status
   */
  async function checkStatus(): Promise<void> {
    checking.value = true
    try {
      const result = await window.api.network.getStatus()
      isOnline.value = result.online
    } catch (error) {
      console.error('[NetworkStore] Failed to check status:', error)
      // Assume offline on error
      isOnline.value = false
    } finally {
      checking.value = false
    }
  }

  /**
   * Force a connectivity check (pings the API server)
   */
  async function forceCheck(): Promise<boolean> {
    checking.value = true
    try {
      const result = await window.api.network.checkConnectivity()
      isOnline.value = result.online
      return result.online
    } catch (error) {
      console.error('[NetworkStore] Connectivity check failed:', error)
      isOnline.value = false
      return false
    } finally {
      checking.value = false
    }
  }

  /**
   * Setup listener for network status changes from main process
   */
  function setupListener(): void {
    if (unsubscribe) {
      return // Already listening
    }

    unsubscribe = window.api.network.onStatusChange((online: boolean) => {
      console.log('[NetworkStore] Network status changed:', online ? 'online' : 'offline')
      isOnline.value = online
    })
  }

  /**
   * Cleanup listener
   */
  function cleanup(): void {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  return {
    isOnline,
    checking,
    checkStatus,
    forceCheck,
    setupListener,
    cleanup
  }
})
