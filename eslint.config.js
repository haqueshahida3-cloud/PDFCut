// ESLint 9 flat config: TypeScript, React Hooks, and the project's own rules.
// Policy: correctness rules (rules-of-hooks, exhaustive-deps) are errors. The React Compiler-based hook rules
// (set-state-in-effect, refs, purity, immutability) are warnings: they flag patterns worth refactoring, but the
// affected code is intentional and tested. They are tracked in docs/AUDIT.md rather than hidden.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'dist-electron', 'release', 'build', 'public', 'node_modules', 'test-results', 'playwright-report', '**/*.cjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.{mjs,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
