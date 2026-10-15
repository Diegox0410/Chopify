import { defineConfig } from 'vitest/config'
import { loadEnv as viteLoadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = viteLoadEnv(mode, process.cwd(), '')
  const localTarget = env.CHOPIFY_LOCAL_SANDBOX_API_ENABLED === 'true' && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/.test(env.CHOPIFY_LOCAL_SANDBOX_API_BASE_URL ?? '')
    ? env.CHOPIFY_LOCAL_SANDBOX_API_BASE_URL
    : undefined
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/pilot-sandbox': { target: 'http://127.0.0.1:4179', changeOrigin: false },
        '/__pilot': { target: 'http://127.0.0.1:4179', changeOrigin: false },
        ...(localTarget ? { '/api': { target: localTarget, changeOrigin: false } } : {}),
      },
    },
    test: {
      environment: 'node', globals: true, pool: 'threads', maxWorkers: 1, include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})
