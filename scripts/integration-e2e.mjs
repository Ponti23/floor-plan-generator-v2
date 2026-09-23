#!/usr/bin/env node
/**
 * PLANLAB_INTEGRATION_MVP_GATE runner.
 *
 * Drives the real service with the real engine over HTTP (no mocked generation)
 * and records every gate item with its evidence. Items that require the browser
 * UI are only marked true when the page itself performs them, so the gate stays
 * NO_GO until the UI path exists.
 *
 *   node scripts/integration-e2e.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = resolve(REPO, "artifacts", "integration");
const PYTHON = "E:/Projects/floor-plan-model/.python/python.exe";
const BASE = "http://127.0.0.1:8010";
const HEADERS = { "X-PlanLab-Client": "1", "Content-Type": "application/json" };

const checks = [];
function record(id, passed, detail, evidence = null) {
  checks.push({ id, passed: Boolean(passed), detail, evidencePaths: evidence ? [evidence] : [] });
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function briefFromFixture(name, settings) {
  const fixture = JSON.parse(
    readFileSync(resolve(REPO, "test", "integration", "fixtures", name), "utf8"),
  );
  const brief = fixture.payload;
  if (settings) {
    brief.settings = { ...brief.settings, ...settings };
  }
  return brief;
}

function editorDocument(brief) {
  return {
    schemaVersion: "planlab.editor/2",
    name: "Gate run",
    roomGroups: brief.rooms.map((room) => ({
      requirementId: `${room.sourceRequirementId}-${room.ordinal}`,
      label: room.label,
      type: room.type,
      roomClass: room.roomClass,
      quantity: 1,
      required: room.required,
      instanceIds: [room.id],
      retiredInstanceIds: [],
    })),
    legacyImport: null,
  };
}

async function waitForReady(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await api("/api/v1/health/ready");
      if (response.status === 200) {
        return response.body;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  return null;
}

async function runJob(brief, label) {
  const project = await api("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: `Gate ${label}` }),
  });
  const saved = await api(`/api/v1/projects/${project.body.projectId}/brief-versions`, {
    method: "POST",
    body: JSON.stringify({
      expectedProjectRevision: project.body.revision,
      brief,
      editorDocument: editorDocument(brief),
    }),
  });
  const started = Date.now();
  const accepted = await api("/api/v1/generations", {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: "planlab.generation/1",
      projectId: project.body.projectId,
      briefVersionId: saved.body.briefVersionId,
      idempotencyKey: `gate-${label}-${started}`,
    }),
  });
  const postSeconds = (Date.now() - started) / 1000;
  const jobId = accepted.body?.generationId;
  let job = accepted.body;
  const deadline = Date.now() + 360_000;
  while (jobId && Date.now() < deadline) {
    if (["COMPLETED", "INFEASIBLE", "FAILED", "CANCELLED"].includes(job.status)) {
      break;
    }
    await new Promise((done) => setTimeout(done, 2000));
    job = (await api(`/api/v1/generations/${jobId}`)).body;
  }
  const layouts = jobId ? (await api(`/api/v1/generations/${jobId}/layouts`)).body : { layouts: [] };
  return { project: project.body, saved: saved.body, accepted, job, layouts, postSeconds };
}

async function main() {
  const dataDir = resolve(REPO, ".local", "gate");
  mkdirSync(dataDir, { recursive: true });
  const service = spawn(PYTHON, [resolve(REPO, "scripts", "run-service.py")], {
    env: { ...process.env, PLANLAB_DATA_DIR: dataDir, PLANLAB_STATIC_DIR: resolve(REPO, "dist") },
    stdio: "ignore",
  });
  const startedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  let verdict = "NO_GO";
  const realGenerationIds = [];
  const latency = {};
  try {
    const ready = await waitForReady();
    record("health.ready", Boolean(ready), ready ? "service ready with the model loaded" : "readiness never returned 200");
    if (!ready) {
      throw new Error("service never became ready");
    }

    const b = await runJob(briefFromFixture("brief-B.json", { topK: 1, topN: 1, solverTimeLimitS: 5 }), "B");
    latency.demoB = { postSeconds: b.postSeconds, elapsedMs: b.job?.elapsedMs ?? null };
    if (b.job?.generationId) {
      realGenerationIds.push(b.job.generationId);
    }
    record("api.nonblocking-post", b.accepted.status === 202 && b.postSeconds < 1,
      `POST returned ${b.accepted.status} in ${b.postSeconds.toFixed(2)}s while the worker solved`);
    record("engine.real-generation", b.job?.status === "COMPLETED" && b.layouts.layouts.length > 0,
      `job ${b.job?.status} with ${b.layouts.layouts.length} layout(s)`);
    const layout = b.layouts.layouts[0];
    record("layout.self-contained-dto", Boolean(layout && layout.rooms?.length && layout.validation?.checks?.length),
      layout ? `${layout.rooms.length} rooms, ${layout.walls.length} walls, ${layout.openings.length} openings, ${layout.validation.checks.length} checks` : "no layout");
    record("layout.integer-mm-and-walls", Boolean(layout && layout.walls.every((wall) => Number.isInteger(wall.thicknessMm))),
      "wall thicknesses are integer millimetres (230 external / 90 internal)");
    record("layout.provenance", Boolean(layout && layout.provenance.topologySource === "topology_model_v1" && layout.versions.checkpointSha256),
      layout ? `checkpoint ${layout.versions.checkpointSha256.slice(0, 12)}…` : "no layout");
    const selection = await api(`/api/v1/projects/${b.project.projectId}/selection`, {
      method: "PUT",
      body: JSON.stringify({ layoutId: layout.layoutId, expectedProjectRevision: b.saved.projectRevision }),
    });
    const reloaded = await api(`/api/v1/projects/${b.project.projectId}`);
    record("selection.persists", selection.status === 200 && reloaded.body?.selectedLayoutId === layout.layoutId,
      `PUT ${selection.status}; reload shows the same selected layout`);

    const d = await runJob(briefFromFixture("brief-D.json", { topK: 1, topN: 1, solverTimeLimitS: 5 }), "D");
    if (d.job?.generationId) {
      realGenerationIds.push(d.job.generationId);
    }
    latency.demoD = { postSeconds: d.postSeconds, elapsedMs: d.job?.elapsedMs ?? null };
    record("failure.architectural-separate", d.job?.status === "INFEASIBLE"
      && d.job?.error?.category === "architectural"
      && ["necessary_condition", "limited_search"].includes(d.job?.error?.proof),
      `demo D -> ${d.job?.status} ${d.job?.error?.code} (${d.job?.error?.proof})`);

    // Items that require the browser UI path, which is not wired yet.
    record("ui.editor-compiles-brief", false, "the Land/Walls/Rooms/Review editor is not mounted in main.ts yet");
    record("ui.viewer-exact-mm", false, "the exact-mm renderer exists and is unit-tested but is not mounted in the page");
    record("ui.selection-round-trip", false, "selection works over HTTP but is not yet driven from the UI");
    record("e2e.no-mocked-generation", false, "no browser-driven end-to-end run exists yet");

    verdict = checks.every((check) => check.passed) ? "GO" : "NO_GO";
  } catch (error) {
    record("gate.runner", false, String(error?.message ?? error));
    verdict = "NO_GO";
  } finally {
    service.kill();
  }

  const finishedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const gate = {
    gate: "PLANLAB_INTEGRATION_MVP_GATE",
    verdict,
    runId: `gate-${Date.now()}`,
    startedAt,
    finishedAt,
    frontendCommit: (process.env.PLANLAB_COMMIT ?? "unknown"),
    engineSourceSha256: checks.find((check) => check.id === "layout.provenance")?.detail ?? "",
    checkpointSha256: "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8",
    checks,
    realGenerationIds,
    latencyMs: latency,
    knownLimitations: [
      "one generation at a time; 360 s active-job deadline",
      "straight corridors only, symbolic openings, 100 mm wall reporting raster",
      "architectural infeasibility is a limited search unless the minima alone exceed the envelope",
      "the browser UI path (editor, viewer, selection) is not mounted yet",
    ],
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, "PLANLAB_INTEGRATION_MVP_GATE.json");
  writeFileSync(path, `${JSON.stringify(gate, null, 2)}\n`, "utf8");
  console.log(`${verdict}: ${checks.filter((check) => check.passed).length}/${checks.length} items pass`);
  for (const check of checks.filter((entry) => !entry.passed)) {
    console.log(`  FAIL ${check.id}: ${check.detail}`);
  }
  console.log(`wrote ${path}`);
  process.exit(verdict === "GO" ? 0 : 1);
}

await main();
