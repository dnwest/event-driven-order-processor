import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript's compiler already resolves identifiers, so no-undef is both
    // redundant and a source of false positives on Node globals here.
    rules: {
      'no-undef': 'off',
    },
  },
);
