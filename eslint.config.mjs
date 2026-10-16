import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // XSS: proibido HTML bruto; qualquer exceção exige sanitização revisada e ADR.
      'react/no-danger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**']),
]);
