import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
          if (id.includes('opensheetmusicdisplay')) {
            return 'osmd-vendor'
          }
          if (id.includes('vexflow')) {
            return 'vexflow-vendor'
          }
          if (id.includes('react-router-dom')) {
            return 'router-vendor'
          }
          return undefined
        },
      },
    },
  },
})
