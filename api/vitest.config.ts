import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/repo/postgres.ts'],
      thresholds: {
        lines: 75,
        functions: 80,
        statements: 75,
        branches: 70
      }
    }
  }
});
