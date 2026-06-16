/**
 * Quote Buddy — ESLint Governance Configuration
 *
 * Two-tier enforcement:
 *   - ERROR: Critical governance violations (block CI)
 *   - WARN:  Code quality issues (visible, fix gradually)
 *
 * To raise the bar over time, promote warnings to errors as the
 * codebase is cleaned. See claude.md Part 4 and Part 14.
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: { jsx: true },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import'],
  settings: {
    react: { version: 'detect' },
  },
  ignorePatterns: [
    'dist',
    'build',
    'node_modules',
    'android',
    'ios',
    'public',
    'coverage',
    '*.config.ts',
    '*.config.js',
    '*.config.cjs',
    'vite.config.ts',
    'vitest.config.ts',
    'capacitor.config.ts',
    'generate-icons.js',
    'generate-password-hash.js',
  ],
  rules: {
    // ============================================================
    // GOVERNANCE — HARD ERRORS (block CI)
    // ============================================================
    'no-debugger': 'error',
    'no-throw-literal': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'no-empty': ['error', { allowEmptyCatch: false }],
    'no-unreachable': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-useless-escape': 'warn',
    'no-constant-condition': 'warn',
    '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
    '@typescript-eslint/ban-ts-comment': [
      'error',
      {
        'ts-ignore': 'allow-with-description',
        'ts-nocheck': true,
        'ts-expect-error': 'allow-with-description',
      },
    ],

    // ============================================================
    // GOVERNANCE — WARNINGS (fix gradually)
    // ============================================================
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-empty-function': 'warn',

    // React
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react/no-unescaped-entities': 'off',

    // Imports
    'import/no-duplicates': 'warn',
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      files: ['*.cjs', '*.config.ts', '*.config.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-console': 'off',
      },
    },
  ],
};
