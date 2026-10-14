import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        lyric: resolve(import.meta.dirname, 'index.html'),
        genre: resolve(import.meta.dirname, 'genre.html'),
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
