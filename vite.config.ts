import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    pool: 'threads',
    maxWorkers: 1,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
