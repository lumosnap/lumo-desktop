import './assets/main.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/700.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

console.log('main.ts loaded')

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.mount('#app')
console.log('App mounted')
