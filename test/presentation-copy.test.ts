import assert from "node:assert/strict";
import test from "node:test";
import { RECOMMENDED_PRESENTATION_COPY, resolvePresentationCopy } from "../src/app/presentation-copy.ts";

test("recommended presentation copy exposes replaceable strategy, metric, and status language", () => {
  assert.deepEqual(Object.keys(RECOMMENDED_PRESENTATION_COPY.strategyNames), ["compactEfficiency", "bestFlow", "balanced"]);
  assert.equal(RECOMMENDED_PRESENTATION_COPY.metricLabels.programSpace, "Space utilization");
  assert.match(RECOMMENDED_PRESENTATION_COPY.status.conceptualUseNotice, /verify dimensions/i);
});

test("copy overrides merge one presentation group without losing recommended defaults", () => {
  const copy = resolvePresentationCopy({
    strategyNames: { balanced: "Balanced custom" },
    ui: { units: { squareMetre: "sqm" }, offsetLabels: { north: "Rear" } },
    status: { commitPrompt: "Review and run." },
  });

  assert.equal(copy.strategyNames.balanced, "Balanced custom");
  assert.equal(copy.strategyNames.bestFlow, RECOMMENDED_PRESENTATION_COPY.strategyNames.bestFlow);
  assert.equal(copy.ui.units.squareMetre, "sqm");
  assert.equal(copy.ui.units.metre, RECOMMENDED_PRESENTATION_COPY.ui.units.metre);
  assert.equal(copy.ui.offsetLabels.north, "Rear");
  assert.equal(copy.ui.offsetLabels.south, RECOMMENDED_PRESENTATION_COPY.ui.offsetLabels.south);
  assert.equal(copy.status.commitPrompt, "Review and run.");
  assert.equal(copy.status.complete, RECOMMENDED_PRESENTATION_COPY.status.complete);
});
