import "./styles.css";
import { CANONICAL_PROJECT } from "../domain/fixtures.ts";
import type { Layout } from "../domain/layout.ts";
import type { ProjectBrief } from "../domain/model.ts";
import type { GenerationResultPayload } from "../domain/resultPayload.ts";
import { GenerationController, type GenerationState, type WorkerPort } from "../worker/controller.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
let project: ProjectBrief = structuredClone(CANONICAL_PROJECT);
let selectedLayoutId: string | null = null;
let result: GenerationResultPayload | null = null;

const controller = new GenerationController(
  () => new Worker(new URL("../worker/generation.worker.ts", import.meta.url), { type: "module" }) as WorkerPort,
);

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function planSvg(layout: Layout | undefined): string {
  const site = { x: 0, y: 0, width: project.site.widthMm / 250, depth: project.site.depthMm / 250 };
  const spaces = layout?.spaces.map((space) => {
    const { x, y, width, depth } = space.rect;
    return `<g><rect class="space ${space.role}" x="${x}" y="${y}" width="${width}" height="${depth}"/><text x="${x + width / 2}" y="${y + depth / 2}">${escapeText(space.instanceId)}</text></g>`;
  }).join("") ?? "";
  const footprint = layout ? `<rect class="footprint" x="${layout.footprint.x}" y="${layout.footprint.y}" width="${layout.footprint.width}" height="${layout.footprint.depth}"/>` : "";
  return `<svg role="img" aria-label="Generated floor plan" viewBox="-3 -3 ${site.width + 6} ${site.depth + 6}">
    <defs><pattern id="grid" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M 4 0 L 0 0 0 4"/></pattern></defs>
    <rect class="grid" x="0" y="0" width="${site.width}" height="${site.depth}"/><rect class="site" x="0" y="0" width="${site.width}" height="${site.depth}"/>${footprint}${spaces}
    <text class="north" x="4" y="7">N ↑</text>
  </svg>`;
}

function render(state: Readonly<GenerationState>): void {
  result = state.lastCompatibleResult;
  const selectedIds = result?.selection.selected.map((item) => item.layoutId) ?? [];
  if (!selectedLayoutId || !selectedIds.includes(selectedLayoutId)) selectedLayoutId = selectedIds[0] ?? null;
  const layout = result?.layouts.find((item) => item.id === selectedLayoutId);
  const analysis = result?.candidates.find((item) => item.layoutId === selectedLayoutId);
  const buttons = result?.selection.selected.map((item) => {
    const score = analysis?.scores.find((candidate) => candidate.profileId === item.strategy);
    return `<button class="option ${item.layoutId === selectedLayoutId ? "selected" : ""}" data-layout="${escapeText(item.layoutId)}"><span>${escapeText(item.strategy)}</span><strong>${score?.overallScore ?? "—"}</strong></button>`;
  }).join("") ?? "";
  const categories = analysis?.scores[0] ? Object.entries(analysis.scores[0].categoryScores).map(([key, value]) => `<li><span>${escapeText(key)}</span><strong>${value}</strong></li>`).join("") : "";
  const progress = state.progress ? `${state.progress.phase} · ${state.progress.expandedStates} expansions · ${state.progress.validCandidates} valid` : "Ready";

  app.innerHTML = `<header><strong>PlanLab</strong><span>Worker vertical slice</span><output data-status="${state.status}">${state.status}</output></header>
    <main>
      <aside class="brief"><h2>Brief</h2>
        <label>Project name<input id="name" value="${escapeText(project.name)}"></label>
        <label>Site width (mm)<input id="width" inputmode="numeric" value="${project.site.widthMm}"></label>
        <label>Site depth (mm)<input id="depth" inputmode="numeric" value="${project.site.depthMm}"></label>
        <label>Seed<input id="seed" value="${escapeText(project.generation.seed)}"></label>
        <p class="hint">250 mm planning grid</p>
        <h3>Program</h3><ul class="program">${project.program.map((room) => `<li>${escapeText(room.label)} <span>×${room.quantity}</span></li>`).join("")}</ul>
        <div class="actions"><button id="generate">Generate</button><button id="cancel" ${state.status === "generating" ? "" : "disabled"}>Cancel</button><button id="retry" ${state.status === "workerError" || state.status === "budgetExceeded" ? "" : "disabled"}>Retry</button></div>
        <p class="progress" aria-live="polite">${escapeText(progress)}</p>${state.error ? `<p class="error">${escapeText(state.error)}</p>` : ""}
      </aside>
      <section class="canvas"><div class="legend"><span>Site</span><span>Footprint</span><span>Room</span><span>Circulation</span></div>${planSvg(layout)}</section>
      <aside class="analysis"><h2>Options</h2><div class="options">${buttons || "<p>No compatible result yet.</p>"}</div><h3>Analysis</h3><ul class="metrics">${categories || "<li>Generate to inspect result metrics.</li>"}</ul></aside>
    </main>`;

  app.querySelector("#generate")?.addEventListener("click", () => controller.start(project, project.generation.seed));
  app.querySelector("#cancel")?.addEventListener("click", () => controller.cancel());
  app.querySelector("#retry")?.addEventListener("click", () => controller.retry());
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-layout]")) button.addEventListener("click", () => { selectedLayoutId = button.dataset.layout!; render(controller.state); });
  bindText("name", (value) => { project.name = value; });
  bindText("seed", (value) => { project.generation.seed = value; });
  bindNumber("width", (value) => { project.site.widthMm = value; });
  bindNumber("depth", (value) => { project.site.depthMm = value; });
}

function bindText(id: string, commit: (value: string) => void): void {
  app.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("change", (event) => commit((event.currentTarget as HTMLInputElement).value));
}
function bindNumber(id: string, commit: (value: number) => void): void {
  app.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("change", (event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isSafeInteger(value) && value > 0) commit(value);
  });
}

controller.subscribe(render);
