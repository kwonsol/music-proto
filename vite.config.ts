import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // 기존 앱(index.html)과 앨범 DJ 프로토타입(dj.html)을 함께 빌드
      input: { main: resolve(import.meta.dirname, 'index.html'), dj: resolve(import.meta.dirname, 'dj.html') },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
