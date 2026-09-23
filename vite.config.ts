import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        engine: resolve(import.meta.dirname, "engine.html"),
      },
    },
  },
  server: {
    proxy: {
      // dev only: the API runs as a separate local process on 8010
      "/api": {
        target: "http://127.0.0.1:8010",
        changeOrigin: false,
      },
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
