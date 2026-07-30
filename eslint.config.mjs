import next from 'eslint-config-next'
import tsPlugin from '@typescript-eslint/eslint-plugin'

/**
 * ESLint flat config.
 * eslint-config-next v16 ships a native flat config array, so we spread it
 * directly (no @eslint/eslintrc FlatCompat shim needed). Custom rule overrides
 * must re-declare the @typescript-eslint plugin in their own config object.
 */
const eslintConfig = [
  ...next,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  {
    ignores: [
      '.next/',
      '.pgdata/',
      'scripts/**',
      'data/**',
      'reports/**',
      'src/payload-types.ts',
      'src/payload-generated-schema.ts',
    ],
  },
]

export default eslintConfig
