import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist'
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['westos.dev', 'localhost'],

    proxy: {
      '/api': 'http://backend:5000',
      '/flows': 'http://backend:5000',
      '/auth': 'http://backend:5000',
      '/plaid': 'http://backend:5000'
    }
  }
})
