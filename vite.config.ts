import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'vertical-timeline.js',
    },
    rollupOptions: {
      external: [/^d3-/],
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
