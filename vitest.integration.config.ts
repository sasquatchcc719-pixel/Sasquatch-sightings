import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.integration.setup.ts'],
    include: ['**/*.integration.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: configDefaults.exclude,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
