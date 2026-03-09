import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/NeuTask/',
  server: {
    port: 5173,
    open: true
  },
  optimizeDeps: {
    include: ['jszip']
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    commonjsOptions: {
      include: [/jszip/, /node_modules/]
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'patch-tracker': resolve(__dirname, 'patch-tracker.html'),
      }
    }
  }
})
