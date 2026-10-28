import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Production-backed integration tests write temporary records. Keep them
    // out of every default/unit test command; they require the explicit gated
    // integration config instead.
    exclude: [
      ...configDefaults.exclude,
      '**/*.integration.test.*',
      // Legacy integration tests also load credentials and contact live services.
      'src/lib/twilio/forward-numbers.test.ts',
      'src/lib/ops/duration-conflict.test.ts',
      'src/lib/gsc-watch.test.ts',
      'src/lib/ops/review-requests.test.ts',
      'src/lib/telegram/relay.test.ts',
      'src/lib/ops/conversation-customer-context.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
