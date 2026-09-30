import { defineConfig } from 'vite';

// Builds the playground (index.html + demo/) as a static site for GitHub Pages.
// Relative base so it works under any repository path (user.github.io/<repo>/).
export default defineConfig({
  base: './',
  build: {
    outDir: 'site',
    emptyOutDir: true,
  },
});
