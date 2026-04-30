import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'vexflow-src': fileURLToPath(new URL('../../node_modules/vexflow/build/esm/src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (id.includes('opensheetmusicdisplay')) {
            return 'osmd-vendor'
          }
          if (normalizedId.includes('/node_modules/vexflow/build/esm/src/fonts/')) {
            return 'vexflow-fonts'
          }
          if (normalizedId.includes('/node_modules/vexflow/')) {
            return 'vexflow-core'
          }
          if (normalizedId.includes('/node_modules/react-router-dom/')) {
            return 'router-vendor'
          }
          return undefined
        },
      },
    },
  },
})
