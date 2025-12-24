import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_BACKEND_BASE || env.VITE_BACKEND_URL || 'http://localhost:8787'

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        'process.env.APP_DOMAIN': JSON.stringify(env.VITE_APP_DOMAIN || 'https://lumosnap.app'),
        'process.env.API_URL': JSON.stringify(env.VITE_API_URL || 'http://localhost:8787/api/v1'),
        'process.env.BACKEND_BASE': JSON.stringify(backendUrl)
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [vue(), tailwindcss()],
      server: {
        proxy: {
          '/api': {
            target: backendUrl,
            changeOrigin: true,
            secure: false
          }
        }
      }
    }
  }
})
