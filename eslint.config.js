import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // 日本法令テキストには全角スペース (U+3000) が頻出する (例: 「第一章　総則」「附　則」)。
      // コメント・テンプレート文字列・正規表現での使用は許容する (houki-nta-mcp と統一)。
      'no-irregular-whitespace': [
        'error',
        { skipComments: true, skipRegExps: true, skipTemplates: true },
      ],
    },
  },
  {
    // Test files - no type-checking required
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-irregular-whitespace': [
        'error',
        { skipComments: true, skipRegExps: true, skipTemplates: true, skipStrings: true },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '*.js', 'scripts/**', 'examples/**'],
  }
);
