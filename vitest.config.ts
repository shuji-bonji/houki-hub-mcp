import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // v0.2.0 で削除予定（sandbox からは rm できないため、ユーザー側で手作業削除）
    exclude: [
      'node_modules',
      'src/abbreviations/**',
      'src/knowledge/business-law-restrictions.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**',
        'src/index.ts',
        'src/abbreviations/**',
        'src/extensions/**',
        'src/knowledge/business-law-restrictions.ts',
      ],
    },
  },
});
