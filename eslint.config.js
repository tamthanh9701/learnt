import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // QA S2-delta (M2 brownfield): jsx-a11y flat recommended on React/TSX only.
  // This RAISES the eslint error count by surfacing pre-existing a11y issues;
  // those jsx-a11y errors are the PRE-FIX baseline S4 drives to ~0 on changed
  // files. The NFR-B2 hard gate stays the NON-a11y error count (<=37).
  {
    files: ['**/*.tsx'],
    extends: [jsxA11y.flatConfigs.recommended],
  },
])
