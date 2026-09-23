/**
 * Where the exact-engine page should send its API calls.
 *
 * Release mode serves the page and the API from one origin, so the default is
 * the empty string. A page hosted on a static host (Vercel) reaches the model
 * service at a different origin; that deployment sets `VITE_PLANLAB_API_BASE`.
 */

export interface ApiBaseSources {
  /** Build-time value, normally `import.meta.env`. */
  env?: Record<string, unknown> | undefined;
  /** Runtime value, normally `globalThis.__PLANLAB_API_BASE__`. */
  globalOverride?: unknown;
}

function readViteEnv(): Record<string, unknown> {
  try {
    // Vite replaces this exact expression at build time (see vite.config.ts).
    // Under `node --test` there is no `.env`, and the access throws.
    return { VITE_PLANLAB_API_BASE: import.meta.env.VITE_PLANLAB_API_BASE };
  } catch {
    return {};
  }
}

function readGlobalOverride(): unknown {
  return (globalThis as Record<string, unknown>).__PLANLAB_API_BASE__;
}

function normalize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

/**
 * The API base URL without a trailing slash. An empty result means "same
 * origin", which is the local release behaviour.
 */
export function resolveApiBase(sources: ApiBaseSources = {}): string {
  const runtime = normalize(
    sources.globalOverride === undefined ? readGlobalOverride() : sources.globalOverride
  );
  if (runtime) return runtime;
  const env = sources.env ?? readViteEnv();
  return normalize(env?.VITE_PLANLAB_API_BASE);
}
