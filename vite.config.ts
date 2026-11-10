/// <reference types="vitest/config" />
import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// https://vitejs.dev/guide/build.html#library-mode
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      name: "ts-github-backuper",
    },
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {},
  },
  plugins: [dts({ exclude: ["src/tests/*"] })],
  test: {
    environment: "node",
    testTimeout: 60_000,
  },
});
