/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the exact-engine page reaches the model service. Empty means same origin. */
  readonly VITE_PLANLAB_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
