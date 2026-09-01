import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default tseslint.config(
  {
    ignores: ['.nuxt/**', '.output/**', 'node_modules/**', 'data/**', 'backups/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        computed: 'readonly',
        ref: 'readonly',
        useFetch: 'readonly',
        navigateTo: 'readonly',
        usePwa: 'readonly',
        $fetch: 'readonly',
        Event: 'readonly',
        HTMLTextAreaElement: 'readonly',
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
);
