import 'dotenv/config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', workers: 1, timeout: 60000,
  use: { baseURL: 'http://localhost:3100', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node apps/api/src/server.js', url: 'http://localhost:4100/api/auth/csrf',
      env: { PORT: '4100', WEB_ORIGIN: 'http://localhost:3100' }, reuseExistingServer: false },
    { command: 'npm exec -w @stockly/web -- next dev --port 3100', url: 'http://localhost:3100/login', timeout: 120000,
      env: { NEXT_PUBLIC_API_URL: 'http://localhost:4100', NEXT_DIST_DIR: '.next-e2e' }, reuseExistingServer: false }
  ]
});
