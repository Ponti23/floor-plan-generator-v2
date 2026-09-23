import { defineConfig } from "vite";
import { resolve } from "node:path";

// The exact-engine page can be hosted away from the model service (Vercel serves
// the page, the tunnel serves the API). Vite only substitutes env access it can
// see literally, so the value is defined explicitly here.
const apiBase = process.env.VITE_PLANLAB_API_BASE ?? "";

export default defineConfig({
  define: {
    "import.meta.env.VITE_PLANLAB_API_BASE": JSON.stringify(apiBase),
  },
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
