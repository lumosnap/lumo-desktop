import { ref } from 'vue'

export interface ToastAction {
  label: string
  run: () => void
}

// One toast at a time, shown by AppToast in App.vue.
export const current = ref<{ msg: string; action?: ToastAction } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

export function toast(msg: string, action?: ToastAction): void {
  current.value = { msg, action }
  clearTimeout(timer)
  timer = setTimeout(() => (current.value = null), 4200)
}

export function dismissToast(): void {
  current.value = null
}
