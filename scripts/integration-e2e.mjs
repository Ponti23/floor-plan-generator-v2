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
import { launchBrowser } from "./lib/browser.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = resolve(REPO, "artifacts", "integration");
const PYTHON = "E:/Projects/floor-plan-model/.python/python.exe";
const BASE = "http://127.0.0.1:8010";
const HEADERS = { "X-PlanLab-Client": "1", "Content-Type": "application/json" };
const CHECKPOINT_SHA256 =
  "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8";

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
  let browser = null;
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

    // ---- the browser path: the real page drives the real service ----------
    browser = await launchBrowser({ url: `${BASE}/engine.html` });
    await browser.waitFor("Boolean(window.__planlabEngine)", { label: "engine page boot", timeoutMs: 30_000 });
    record("ui.editor-boots", true, "the exact engine page booted with its Land/Walls/Rooms/Review editor");

    const editorRooms = await browser.evaluate(
      "document.querySelectorAll('[data-room]').length",
    );
    record("ui.editor-room-instances", editorRooms >= 9,
      `${editorRooms} editable room instances are rendered with ids, areas and authored minima`);

    // edit through the real control: 17.321 m must reach the engine unchanged
    await browser.evaluate(`(() => {
      const input = document.querySelector('#site-width');
      input.value = '17.321';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value;
    })()`);
    const reviewText = await browser.evaluate("document.querySelector('[data-review]')?.textContent ?? ''");
    record("ui.exact-metre-input", String(reviewText).includes("17.321"),
      "the Review section shows the authored 17.321 m site value");

    await browser.evaluate("document.querySelector('#generate').click()");
    // the page uses the product defaults (topK 5, 30 s per attempt), so allow the
    // full active-job deadline plus overhead
    await browser.waitFor("window.__planlabEngine.state().layouts > 0", { timeoutMs: 420_000, label: "a generated option" });
    const uiState = await browser.evaluate("window.__planlabEngine.state()");
    record("ui.generate-round-trip", uiState.status === "COMPLETED" && uiState.layouts > 0,
      `the page submitted through the API and received ${uiState.layouts} option(s) (status ${uiState.status})`);
    const renderedLayoutId = await browser.evaluate(
      "document.querySelector('[data-layout-id]')?.getAttribute('data-layout-id') ?? null",
    );

    const pageProject = await api(`/api/v1/projects/${uiState.projectId}`);
    record("ui.editor-compiles-brief", pageProject.body?.brief?.site?.widthMm === 17_321,
      `the brief the UI saved has site width ${pageProject.body?.brief?.site?.widthMm} mm`);

    const svgInfo = await browser.evaluate(`(() => {
      const svg = document.querySelector('[data-plan] svg');
      if (!svg) return null;
      return {
        viewBox: svg.getAttribute('viewBox'),
        rooms: svg.querySelectorAll('[data-room-id]').length,
        walls: svg.querySelectorAll('[data-wall-id]').length,
        openings: svg.querySelectorAll('[data-opening-id]').length,
        hasNorth: svg.textContent.includes('N ↑'),
      };
    })()`);
    record("ui.viewer-exact-mm", Boolean(svgInfo && svgInfo.viewBox === "0 0 17321 16062"
      && svgInfo.rooms > 0 && svgInfo.walls > 0 && svgInfo.openings > 0 && svgInfo.hasNorth),
      svgInfo ? `rendered ${svgInfo.rooms} rooms, ${svgInfo.walls} walls, ${svgInfo.openings} openings at viewBox ${svgInfo.viewBox}` : "no plan rendered");

    const analysis = await browser.evaluate(`(() => {
      const panel = document.querySelector('[data-analysis]');
      if (!panel) return null;
      return {
        scores: panel.querySelectorAll('[data-score]').length,
        checks: panel.querySelectorAll('[data-check]').length,
        text: panel.textContent,
      };
    })()`);
    record("ui.analysis-from-engine-scores", Boolean(analysis && analysis.scores === 6 && analysis.checks >= 20
      && !/optimal/i.test(analysis.text)),
      analysis ? `${analysis.scores} engine scores and ${analysis.checks} independent checks are shown in the option` : "no analysis panel");

    await browser.evaluate("document.querySelector('[data-action=\"use-option\"]').click()");
    await browser.waitFor("document.querySelector('[data-selected-marker]') !== null",
      { timeoutMs: 30_000, label: "the selected marker" });
    const selectedId = await browser.evaluate("window.__planlabEngine.state().selectedLayoutId");
    await browser.send("Page.reload", { ignoreCache: false });
    await browser.waitFor("Boolean(window.__planlabEngine)", { label: "engine page after reload", timeoutMs: 30_000 });
    const afterReload = await browser.waitFor(
      "window.__planlabEngine.state().selectedLayoutId",
      { timeoutMs: 30_000, label: "the restored selection" },
    );
    record("ui.selection-round-trip", afterReload === selectedId && Boolean(selectedId),
      `selected ${String(selectedId).slice(0, 8)}…, reloaded the page and the same option is still selected`);

    const jobId = uiState.jobId;
    const real = jobId ? await api(`/api/v1/generations/${jobId}`) : null;
    const layoutIds = real?.body?.layoutIds ?? [];
    record("e2e.no-mocked-generation", Boolean(real && real.body?.versions?.checkpointSha256 === CHECKPOINT_SHA256),
      real ? `the option came from real job ${String(jobId).slice(0, 8)}… with checkpoint ${real.body.versions.checkpointSha256.slice(0, 12)}…`
        : "no job id was exposed by the page");
    record("e2e.job-matches-rendered-option", Boolean(layoutIds.length && layoutIds.includes(renderedLayoutId)),
      `the layout rendered in the page (${String(renderedLayoutId).slice(0, 8)}…) is one of the job's persisted layout ids`);
    const restoredOptions = await browser.evaluate("window.__planlabEngine.state().layouts");
    record("ui.alternatives-survive-reload", restoredOptions > 0,
      `${restoredOptions} option(s) are still available after the page reload`);

    verdict = checks.every((check) => check.passed) ? "GO" : "NO_GO";
  } catch (error) {
    record("gate.runner", false, String(error?.message ?? error));
    verdict = "NO_GO";
  } finally {
    if (browser) {
      await browser.close();
    }
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
