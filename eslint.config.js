import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Direct @prisma/client access is forbidden outside src/db/**. Use src/db/scoped.js instead.',
            },
          ],
          patterns: [
            {
              group: ['**/db/client*', '../db/client*', './client*'],
              message: 'Direct DB client access is forbidden outside src/db/**. Use src/db/scoped.js instead.',
            },
          ],
        },
      ],
    },
  },
);
