import './assets/main.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/300.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// A photo that isn't on disk (not compressed yet, or since removed) leaves the surface behind it
// showing instead of the broken-image icon. Load/error don't bubble, so listen in capture.
document.addEventListener(
  'error',
  (e) => e.target instanceof HTMLImageElement && (e.target.dataset.missing = ''),
  true
)
document.addEventListener(
  'load',
  (e) => e.target instanceof HTMLImageElement && delete e.target.dataset.missing,
  true
)

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.mount('#app')
