#!/usr/bin/env node

/**
 * Manual inspection path for the normalized canonical fixture.
 *
 * Stage 1 bucket 1.3 makes the approved brief inspectable without a UI: this
 * script normalizes the canonical project and writes the deterministic texts
 * that a reviewer reads when checking that authored millimetres, the 250 mm
 * solver grid, the expanded program, and the project fingerprint all agree.
 *
 *   node scripts/inspect-canonical.mjs           # regenerate the artifacts
 *   node scripts/inspect-canonical.mjs --check   # fail if artifacts are stale
 *
 * The same renderers are exercised by `test/project-inspection.test.ts`, so the
 * committed artifacts cannot drift from domain behaviour.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_PROJECT,
  createProjectInspection,
  normalizeProject,
  renderDiscretizationText,
} from "../src/domain/index.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = resolve(REPO_ROOT, "artifacts", "planlab", "milestone-1", "diagnostics");

const inspection = createProjectInspection(normalizeProject(CANONICAL_PROJECT));
const artifacts = [
  { path: resolve(OUTPUT_ROOT, "canonical-fixture.txt"), text: `${inspection.text}\n` },
  {
    path: resolve(OUTPUT_ROOT, "discretization.txt"),
    text: `${renderDiscretizationText(inspection.discretization)}\n`,
  },
];

const checkOnly = process.argv.includes("--check");
let drifted = false;

/** Committed artifacts are LF; a Windows checkout can present them as CRLF. */
const normaliseLineEndings = (text) => text.replaceAll("\r\n", "\n");

for (const artifact of artifacts) {
  const relativePath = artifact.path.slice(REPO_ROOT.length + 1).replaceAll("\\", "/");
  if (checkOnly) {
    let existing;
    try {
      existing = readFileSync(artifact.path, "utf8");
    } catch {
      console.error(`missing artifact: ${relativePath} (run node scripts/inspect-canonical.mjs)`);
      drifted = true;
      continue;
    }
    if (normaliseLineEndings(existing) !== normaliseLineEndings(artifact.text)) {
      console.error(`stale artifact: ${relativePath} (run node scripts/inspect-canonical.mjs)`);
      drifted = true;
      continue;
    }
    console.log(`up to date: ${relativePath}`);
    continue;
  }

  mkdirSync(OUTPUT_ROOT, { recursive: true });
  writeFileSync(artifact.path, artifact.text);
  console.log(`wrote ${relativePath}`);
}

if (checkOnly) {
  if (drifted) process.exitCode = 1;
  else console.log(`canonical inspection matches artifacts; fingerprint ${inspection.fingerprint}`);
}
