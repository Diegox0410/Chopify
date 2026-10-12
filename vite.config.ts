import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/pilot-sandbox': { target: 'http://127.0.0.1:4179', changeOrigin: false },
      '/__pilot': { target: 'http://127.0.0.1:4179', changeOrigin: false },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    pool: 'threads',
    maxWorkers: 1,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
