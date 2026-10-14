import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // 기존 앱(index.html), 앨범 DJ(dj.html), 악보 드로잉(score.html)을 함께 빌드
      input: { main: resolve(import.meta.dirname, 'index.html'), dj: resolve(import.meta.dirname, 'dj.html'), score: resolve(import.meta.dirname, 'score.html') },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
