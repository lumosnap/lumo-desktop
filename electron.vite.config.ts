import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_BACKEND_BASE || env.VITE_BACKEND_URL || 'https://backend.lumosnap.com'

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/main/index.ts'),
            'compression-worker': resolve(__dirname, 'src/main/compression-worker.ts')
          }
        }
      },
      define: {
        'process.env.APP_DOMAIN': JSON.stringify(env.VITE_APP_DOMAIN || 'https://lumosnap.com'),
        'process.env.API_URL': JSON.stringify(
          env.VITE_API_URL || 'https://backend.lumosnap.com/api/v1'
        ),
        'process.env.BACKEND_BASE': JSON.stringify(backendUrl),
        'process.env.AUTH_URL': JSON.stringify(env.VITE_AUTH_URL || 'https://connect.lumosnap.com')
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
