/** The exact-engine page must be able to call the model service cross-origin. */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveApiBase } from "../../src/integration/api-base.ts";

test("same origin is the default when nothing is configured", () => {
  assert.equal(resolveApiBase({ env: {}, globalOverride: null }), "");
  assert.equal(resolveApiBase({ env: undefined, globalOverride: "" }), "");
  assert.equal(resolveApiBase({ env: { OTHER: "x" }, globalOverride: "" }), "");
});

test("a configured base is used and loses its trailing slashes", () => {
  assert.equal(
    resolveApiBase({ env: { VITE_PLANLAB_API_BASE: "https://model.example/" } }),
    "https://model.example"
  );
  assert.equal(
    resolveApiBase({ env: { VITE_PLANLAB_API_BASE: "  https://model.example///  " } }),
    "https://model.example"
  );
});

test("a runtime override wins over the build-time value", () => {
  assert.equal(
    resolveApiBase({
      env: { VITE_PLANLAB_API_BASE: "https://build.example" },
      globalOverride: "https://runtime.example/",
    }),
    "https://runtime.example"
  );
});

test("non-string and blank values fall back to same origin", () => {
  assert.equal(resolveApiBase({ env: { VITE_PLANLAB_API_BASE: 42 } }), "");
  assert.equal(resolveApiBase({ env: { VITE_PLANLAB_API_BASE: "   " } }), "");
});
