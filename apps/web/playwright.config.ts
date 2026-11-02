import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { defineConfig } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:8766' },
  webServer: {
    command: 'python ../../tests/e2e_web_server.py',
    cwd: here,
    url: 'http://127.0.0.1:8766/api/v1/health',
    reuseExistingServer: false,
  },
})
