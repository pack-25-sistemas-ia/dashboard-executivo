import { defineConfig, devices } from '@playwright/test';

// Requer um Supabase local (core/supabase) e o app em produção rodando (pnpm build && pnpm start).
// Variáveis: E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_BASE_URL (padrão http://localhost:3000).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'pt-BR',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
