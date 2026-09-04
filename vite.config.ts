import { defineConfig } from 'vitest/config';
import { screenshotPlugin } from './tools/screenshot-plugin';

export default defineConfig({
  base: './',
  plugins: [screenshotPlugin()],
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
