import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'docs/**',
      'samples/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The core package must run unchanged in the browser, in workers and on the future server.
    files: ['packages/core/src/**/*.ts'],
    languageOptions: {
      globals: { ...globals['shared-node-browser'] },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', 'react', 'react-dom', '@mantine/*', '@codemirror/*'] },
      ],
    },
  },
  {
    // Plain scripts served as they are, before the app starts.
    files: ['packages/web/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Every user-visible text belongs in the translation files, in both languages.
    files: ['packages/web/src/**/*.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            include: [
              'label',
              'title',
              'placeholder',
              'aria-label',
              'alt',
              'description',
              'error',
              'tooltip',
              'message',
            ],
          },
        },
      ],
    },
  },
  prettier,
);
