import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9900,
    proxy: {
      '/api': {
        target: 'http://localhost:9901',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:9901',
        changeOrigin: true
      }
    }
  }
})
