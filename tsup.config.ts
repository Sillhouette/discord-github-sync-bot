import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['cjs'],
  target: 'node18',
  sourcemap: false,
  minify: true,
  splitting: false,
  clean: true,
  shims: true,
});
