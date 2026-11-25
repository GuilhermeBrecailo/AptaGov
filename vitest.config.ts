import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Nunca deixar teste abrir o banco do .env (em produção é o banco real).
    env: { DATABASE_URL: ':memory:' },
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
