import { defineConfig } from '@playwright/test';

// Browser smoke tests: `npm run e2e` (builds first). In CI Playwright installs its own
// Chromium; locally you can point PLAYWRIGHT_CHROMIUM at an existing binary.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  timeout: 180_000,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
      // Software WebGL so the game renders on CI machines without a GPU.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npx vite preview --port 4180 --strictPort',
    url: 'http://localhost:4180',
    reuseExistingServer: !process.env.CI,
  },
});
