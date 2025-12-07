/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/'],
    },
    // Use test-specific tsconfig
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@components': resolve(__dirname, './src/components'),
      '@lib': resolve(__dirname, './src/lib'),
    },
  },
});

