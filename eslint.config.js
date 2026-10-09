import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The sim must be bit-for-bit deterministic across JS engines (V8, JavaScriptCore).
// Only + - * / and Math.sqrt are guaranteed IEEE-exact; everything else goes through
// packages/sim/src/math.
const nonDeterministicMath = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'exp',
  'expm1',
  'log',
  'log2',
  'log10',
  'log1p',
  'pow',
  'sinh',
  'cosh',
  'tanh',
  'cbrt',
  'hypot',
].map((property) => ({
  object: 'Math',
  property,
  message: 'Not deterministic across engines. Use the helpers in packages/sim/src/math.',
}));

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/web/android/**',
      'apps/web/ios/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/sim/src/**/*.ts', 'packages/bots/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nonDeterministicMath],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'No wall-clock time in the sim.' },
        { name: 'performance', message: 'No wall-clock time in the sim.' },
        { name: 'window', message: 'The sim is headless.' },
        { name: 'document', message: 'The sim is headless.' },
      ],
    },
  },
);
