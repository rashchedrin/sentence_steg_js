import { defineConfig } from "vite";

/** GitHub Pages project site base, e.g. `/sentence_steg_js/`. */
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    testTimeout: 120_000,
  },
});
