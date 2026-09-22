/**
 * Stage 1 bucket 1.3 — canonical fixture and discretization diagnostics.
 *
 * The approved Milestone 0 envelope (20 × 30 m site, 17 × 22 m buildable
 * envelope) must stay exact and inspectable, and authored millimetres that the
 * 250 mm grid cannot represent must be reported rather than silently absorbed.
 * The committed artifacts under `artifacts/planlab/milestone-1/diagnostics/`
 * are checked against these renderers so the documented manual path stays true.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  GRID_MM,
  createCanonicalProject,
  createDiscretizationDiagnostic,
  createProjectInspection,
  fingerprintNormalizedProject,
  normalizeProject,
  normalizeSite,
  renderDiscretizationText,
  renderProjectInspectionText,
  type NormalizedProject,
  type NormalizedSite,
} from "../src/domain/index.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIAGNOSTIC_ROOT = resolve(REPO_ROOT, "artifacts", "planlab", "milestone-1", "diagnostics");

/**
 * Committed text artifacts are stored with LF. A Windows checkout with
 * `core.autocrlf=true` presents them as CRLF, so the comparison is normalised
 * for line endings only; geometry, numbers and hashes stay byte-exact.
 */
function readFixtureText(path: string): string {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

const CANONICAL_FIXTURE = readFixtureText(resolve(DIAGNOSTIC_ROOT, "canonical-fixture.txt"));
const DISCRETIZATION_FIXTURE = readFixtureText(resolve(DIAGNOSTIC_ROOT, "discretization.txt"));

interface SiteOverrides {
  widthMm?: number;
  depthMm?: number;
  westMm?: number;
  eastMm?: number;
  northMm?: number;
  southMm?: number;
}

function briefWith(overrides: SiteOverrides): ReturnType<typeof createCanonicalProject> {
  const brief = createCanonicalProject("discretization-oracle");
  if (overrides.widthMm !== undefined) brief.site.widthMm = overrides.widthMm;
  if (overrides.depthMm !== undefined) brief.site.depthMm = overrides.depthMm;
  const offsets: readonly [keyof typeof brief.site.offsets, number | undefined][] = [
    ["west", overrides.westMm],
    ["east", overrides.eastMm],
    ["north", overrides.northMm],
    ["south", overrides.southMm],
  ];
  for (const [side, distanceMm] of offsets) {
    if (distanceMm !== undefined) brief.site.offsets[side].distanceMm = distanceMm;
  }
  return brief;
}

/** Site-only normalization: the sweep checks grid geometry, not program fit. */
function siteWith(overrides: SiteOverrides): NormalizedSite {
  return normalizeSite(briefWith(overrides).site);
}

function projectWith(overrides: SiteOverrides): NormalizedProject {
  return normalizeProject(briefWith(overrides));
}

test("the canonical fixture inspection reports the approved exact geometry", () => {
  const inspection = createProjectInspection(CANONICAL_NORMALIZED_PROJECT);
  const { discretization } = inspection;

  assert.deepEqual(discretization.site.exactSiteMm, {
    x: 0,
    y: 0,
    width: 20_000,
    depth: 30_000,
  });
  assert.deepEqual(discretization.site.envelope, { x: 6, y: 8, width: 68, depth: 88 });
  assert.deepEqual(discretization.site.snappedEnvelopeMm, {
    x: 1_500,
    y: 2_000,
    width: 17_000,
    depth: 22_000,
  });
  assert.deepEqual(discretization.site.gridInsetLossMm, { north: 0, east: 0, south: 0, west: 0 });
  assert.deepEqual(discretization.siteTruncationMm, { width: 0, depth: 0 });
  assert.equal(discretization.site.discretizationLossMm2, 0);
  assert.equal(discretization.exact, true);
  assert.deepEqual(
    discretization.findings.map((finding) => finding.code),
    ["EXACT_GRID_FIT"],
  );
  assert.equal(inspection.fingerprint, fingerprintNormalizedProject(CANONICAL_NORMALIZED_PROJECT));

  const lines = inspection.text.split("\n");
  assert.equal(lines[0], "PlanLab project inspection planlab-project-inspection-1");
  assert.ok(lines.includes(`Fingerprint: ${inspection.fingerprint}`));
  assert.ok(lines.includes("Snapped envelope: 68 × 88 units at x 6, y 8 = 17000 × 22000 mm at x 1500 mm, y 2000 mm"));
  assert.ok(lines.includes("Discretization loss: 0 mm² (0.00 m²)"));
  assert.ok(lines.includes("Program: 8 room instances"));
  assert.ok(lines.some((line) => line.startsWith("- garage-1: garage")));
  assert.ok(lines.includes("Relationships: 2"));
  assert.ok(lines.includes("Planning: min circulation 1000 mm (4 units) | target GFA 180.00 m² | max GFA 200.00 m² | max unallocated interior 5.0%"));
});

test("non-grid authored values report truncation and inset loss", () => {
  const project = projectWith({
    widthMm: 12_345,
    depthMm: 20_345,
    westMm: 1_123,
    eastMm: 1_500,
  });
  const diagnostic = createDiscretizationDiagnostic(project);

  // The authored site is floored to whole grid units and the offsets ceil/floor inward.
  assert.deepEqual(diagnostic.site.site, { x: 0, y: 0, width: 49, depth: 81 });
  assert.deepEqual(diagnostic.siteTruncationMm, { width: 95, depth: 95 });
  assert.deepEqual(diagnostic.site.envelope, { x: 5, y: 8, width: 38, depth: 49 });
  assert.deepEqual(diagnostic.site.snappedEnvelopeMm, {
    x: 1_250,
    y: 2_000,
    width: 9_500,
    depth: 12_250,
  });
  assert.deepEqual(diagnostic.site.gridInsetLossMm, { north: 0, east: 95, south: 95, west: 127 });
  assert.equal(diagnostic.site.discretizationLossMm2, 9_722 * 12_345 - 9_500 * 12_250);
  assert.equal(diagnostic.exact, false);
  assert.deepEqual(
    diagnostic.findings.map((finding) => finding.code),
    ["SITE_TRUNCATED_TO_GRID", "ENVELOPE_INSET_LOSS"],
  );
  assert.ok(diagnostic.findings.every((finding) => finding.severity === "warning"));

  const text = renderDiscretizationText(diagnostic);
  assert.ok(text.includes("truncated width 95 mm, depth 95 mm"));
  assert.ok(text.includes("Inset loss: north 0 mm, east 95 mm, south 95 mm, west 127 mm"));
  assert.ok(text.includes("- ENVELOPE_INSET_LOSS (warning):"));
});

test("conservative snapping keeps its invariants across authored millimetres", () => {
  // Deterministic sweep over values that straddle grid boundaries and offsets
  // that are already exact, so the property is checked, not one sample.
  const widths = [20_000, 12_345, 19_999, 20_001, 20_249, 20_250, 20_251];
  const offsets = [0, 1, 124, 125, 126, 249, 250, 251, 1_123, 4_999];
  for (const widthMm of widths) {
    for (const offsetMm of offsets) {
      const site = siteWith({ widthMm, westMm: offsetMm, eastMm: offsetMm });
      assert.equal(site.site.width, Math.floor(widthMm / GRID_MM));
      assert.equal(site.site.x, 0);
      assert.equal(site.site.y, 0);

      const exactArea = site.exactEnvelopeMm.width * site.exactEnvelopeMm.depth;
      const snappedArea = site.snappedEnvelopeMm.width * site.snappedEnvelopeMm.depth;
      assert.equal(site.discretizationLossMm2, exactArea - snappedArea);
      assert.ok(site.discretizationLossMm2 >= 0);
      assert.ok(site.envelope.width >= 1 && site.envelope.depth >= 1);

      for (const loss of Object.values(site.gridInsetLossMm)) {
        assert.ok(Number.isInteger(loss) && loss >= 0 && loss < GRID_MM, `loss ${loss}`);
      }
      // The snapped envelope never leaves the authored envelope.
      assert.ok(site.snappedEnvelopeMm.x >= site.exactEnvelopeMm.x);
      assert.ok(site.snappedEnvelopeMm.y >= site.exactEnvelopeMm.y);
      assert.ok(
        site.snappedEnvelopeMm.x + site.snappedEnvelopeMm.width <=
          site.exactEnvelopeMm.x + site.exactEnvelopeMm.width,
      );
      assert.ok(
        site.snappedEnvelopeMm.y + site.snappedEnvelopeMm.depth <=
          site.exactEnvelopeMm.y + site.exactEnvelopeMm.depth,
      );
    }
  }

  // Authored offsets that leave no envelope are a structured error, not a clamp.
  assert.throws(() => siteWith({ widthMm: 8_125, westMm: 4_999, eastMm: 4_999 }));
});

test("inspection renderers are deterministic and match the committed artifacts", () => {
  const first = createProjectInspection(CANONICAL_NORMALIZED_PROJECT);
  const second = createProjectInspection(CANONICAL_NORMALIZED_PROJECT);
  assert.equal(first.text, second.text);
  assert.equal(renderProjectInspectionText(CANONICAL_NORMALIZED_PROJECT), first.text);
  assert.equal(renderDiscretizationText(first.discretization), DISCRETIZATION_FIXTURE.trimEnd());
  assert.equal(first.text, CANONICAL_FIXTURE.trimEnd());
  assert.ok(CANONICAL_FIXTURE.includes(first.fingerprint));

  // The documented manual path must work from a clean checkout.
  const checked = execFileSync(process.execPath, ["scripts/inspect-canonical.mjs", "--check"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.ok(checked.includes("canonical inspection matches artifacts"));
});
