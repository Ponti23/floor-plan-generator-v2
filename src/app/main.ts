import "./styles.css";
import { CANONICAL_PROJECT } from "../domain/fixtures.ts";
import { GRID_MM } from "../domain/constants.ts";
import type { CardinalSide } from "../domain/geometry.ts";
import { METRIC_CATEGORIES } from "../domain/metrics.ts";
import type { Layout } from "../domain/layout.ts";
import type { NormalizedProject, RoomKind } from "../domain/model.ts";
import type { GenerationResultPayload } from "../domain/resultPayload.ts";
import {
  bumpVariationSeed,
  CARDINAL_SIDES,
  commitBriefDraft,
  createBriefEditorState,
  discardBriefDraft,
  editBriefDraft,
  markBriefResultCurrent,
  type BriefDraft,
  type BriefEditorState,
  type DraftRelationship,
  type DraftRoom,
} from "./editor-state.ts";
import { resolvePresentationCopy } from "./presentation-copy.ts";
import {
  createProjectStore,
  preserveUnreadableDocument,
  storageNoticeKind,
  type ProjectStore,
  type StorageNoticeKind,
  type StoragePort,
} from "./project-store.ts";
import {
  candidateEvidence,
  observationLabel,
  observationExplanations,
  projectCategoryRows,
  projectMetricRows,
  projectOptionCards,
  selectedScorecard,
  type CandidateEvidence,
  type RuleCheckRow,
} from "./analysis-projection.ts";
import { planViewBox, projectEvidenceGeometry, projectPlanSvg } from "./svg-projection.ts";
import {
  createViewportState,
  fitViewport,
  panViewport,
  pointerToViewBox,
  VIEWPORT_ZOOM_FACTOR,
  viewportTransformAttribute,
  zoomViewport,
  type ViewportModeState,
} from "./viewport.ts";
import { GenerationController, type GenerationState, type WorkerPort } from "../worker/controller.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
const copy = resolvePresentationCopy();

/**
 * Local persistence (Milestone 6).  A browser that refuses storage must still
 * get a working workspace, so the port is resolved defensively and every
 * failure is a value the UI can render.
 */
function browserStoragePort(): StoragePort | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const storagePort = browserStoragePort();
const projectStore: ProjectStore | null = storagePort === null ? null : createProjectStore(storagePort);
const storedOutcome = projectStore === null
  ? ({ status: "unavailable", reason: "local storage is not reachable" } as const)
  : projectStore.read();
const storageNotice: StorageNoticeKind | null = storageNoticeKind(storedOutcome);
if (storedOutcome.status === "corrupt" && projectStore !== null && storagePort !== null) {
  // Keep the unreadable copy rather than letting the next save overwrite it.
  preserveUnreadableDocument(storagePort, projectStore);
}

let editor: BriefEditorState = createBriefEditorState(
  storedOutcome.status === "loaded" ? storedOutcome.document.project : CANONICAL_PROJECT,
);
let saveState: "saved" | "saving" | "failed" | "unavailable" = storageNotice === "unavailable" || projectStore === null
  ? "unavailable"
  : "saved";
let lastSavedRevision = editor.revision;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let selectedLayoutId: string | null = null;
let generationRevision: number | null = null;
let expandedRoomId: string | null = "kitchen";
let viewport: ViewportModeState = createViewportState();
let viewportProjectKey = `${editor.committedProject.projectId}:${editor.committedProject.site.site.width}:${editor.committedProject.site.site.depth}`;
let focusedEvidenceRefs: readonly string[] = [];
let pointerSession: { pointerId: number; clientX: number; clientY: number } | null = null;
const committedProjects = new Map<number, NormalizedProject>([
  [editor.revision, editor.committedProject],
]);

const controller = new GenerationController(
  () => new Worker(new URL("../worker/generation.worker.ts", import.meta.url), { type: "module" }) as WorkerPort,
);

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function escapeAttribute(value: string | number): string {
  return escapeText(String(value));
}

function roomKindClass(kind: RoomKind): string {
  return `room-kind-${kind}`;
}

function selectedResult(
  state: Readonly<GenerationState>,
): { result: GenerationResultPayload | null; layout: Layout | undefined; project: NormalizedProject } {
  const result = state.lastCompatibleResult;
  const selectedIds = result?.selection.selected.map((item) => item.layoutId) ?? [];
  if (!selectedLayoutId || !selectedIds.includes(selectedLayoutId)) selectedLayoutId = selectedIds[0] ?? null;
  const project = (editor.resultRevision === null
    ? editor.committedProject
    : committedProjects.get(editor.resultRevision) ?? editor.committedProject);
  return {
    result,
    layout: result?.layouts.find((item) => item.id === selectedLayoutId),
    project,
  };
}

function statusLabel(state: Readonly<GenerationState>): string {
  if (editor.issues.length > 0) return copy.status.invalidBriefLabel;
  if (state.status === "generating") return copy.status.generatingLabel;
  if (editor.resultsStale) return copy.status.staleLabel;
  if (editor.dirty) return copy.status.draftLabel;
  if (state.status === "idle") return copy.status.readyLabel;
  if (state.status === "complete") return copy.status.completeLabel;
  if (state.status === "partial") return copy.status.partialLabel;
  if (state.status === "infeasible") return copy.status.infeasibleLabel;
  if (state.status === "budgetExceeded") return copy.status.budgetExceededLabel;
  if (state.status === "workerError") return copy.status.workerErrorLabel;
  return state.status;
}

/** Elapsed wall-clock seconds of the in-flight run, or null when not running. */
function elapsedSeconds(state: Readonly<GenerationState>): number | null {
  if (state.startedAt === null) return null;
  return Math.max(0, (Date.now() - state.startedAt) / 1000);
}

/** Deterministic progress counters plus the watchdog deadline for the UI. */
function progressReadout(state: Readonly<GenerationState>): string {
  const progress = state.progress;
  const counters = progress
    ? `${progress.phase} · ${progress.expandedStates.toLocaleString()} ${copy.status.progressExpansions} · ${progress.validCandidates} ${copy.status.progressValid}`
    : copy.status.preparing;
  const elapsed = elapsedSeconds(state);
  if (elapsed === null) return counters;
  const budget = Math.round(state.watchdogMs / 1000);
  return `${counters} · ${elapsed.toFixed(1)} s / ${budget} s ${copy.status.progressWatchdog}`;
}

function statusDetail(state: Readonly<GenerationState>): string {
  if (editor.issues.length > 0) return copy.status.invalidBrief;
  if (state.status === "generating") {
    const detail = progressReadout(state);
    return editor.resultsStale ? `${detail} · ${copy.status.staleResults}` : detail;
  }
  if (editor.resultsStale) return copy.status.staleResults;
  if (editor.dirty) return copy.status.draftPrompt;
  if (state.status === "complete") return copy.status.complete;
  if (state.status === "partial") return copy.status.partial;
  if (state.status === "infeasible") return copy.status.infeasible;
  if (state.status === "budgetExceeded") return copy.status.budgetExceeded;
  if (state.status === "workerError") return state.error ?? copy.status.workerError;
  return copy.status.commitPrompt;
}

function issueSummary(): string {
  return editor.issues
    .slice(0, 3)
    .map((issue) => `${issue.path ? `${issue.path}: ` : ""}${issue.message}`)
    .join(" · ");
}

function renderOffsetRows(): string {
  return CARDINAL_SIDES.map((side) => {
    const offset = editor.draft.offsets[side];
    const label = copy.ui.offsetLabels[side] ?? side;
    return `<div class="form-row offset-row"><label for="offset-${side}">${escapeText(label)}</label><input id="offset-${side}" data-offset-side="${side}" inputmode="decimal" value="${escapeAttribute(offset.distanceM)}" aria-label="${escapeAttribute(`${label} (${copy.ui.units.metre})`)}"><span class="unit">${escapeText(copy.ui.units.metre)}</span><select id="offset-${side}-source" data-offset-source="${side}" aria-label="${escapeAttribute(`${label} source`)}">${["architect", "planning", "system", "custom"].map((source) => `<option value="${source}" ${offset.source === source ? "selected" : ""}>${escapeText(copy.ui.offsetSourceLabels[source] ?? source)}</option>`).join("")}</select></div>`;
  }).join("");
}

function roomOptions(selected: DraftRelationship["from"]): string {
  const selectedIsString = typeof selected === "string";
  const selectedLabel = selectedIsString
    ? copy.ui.chooseRoom
    : selected.type === "kind" ? `Kind: ${selected.kind}` : `${selected.type}: ${selected.id}`;
  const placeholderSelected = selectedIsString ? selected === "" : true;
  const options = editor.draft.program.map((room) => `<option value="${escapeAttribute(room.id)}" ${selectedIsString && selected === room.id ? "selected" : ""}>${escapeText(room.label || room.id)}</option>`).join("");
  return `<option value="" ${placeholderSelected ? "selected" : ""}>${escapeText(selectedLabel)}</option>${options}`;
}

function renderRoom(room: DraftRoom, index: number): string {
  const open = expandedRoomId === room.id;
  const summary = room.dimensions.minAreaM2.trim() || "—";
  const dimensions = room.dimensions;
  const advanced = open ? `<div class="room-advanced">
      <div class="form-row"><label for="room-${index}-min-area">${escapeText(copy.ui.roomMinimumArea)}</label><input id="room-${index}-min-area" data-room-index="${index}" data-room-field="minAreaM2" inputmode="decimal" value="${escapeAttribute(dimensions.minAreaM2)}" aria-label="${escapeAttribute(`${room.label} ${copy.ui.roomMinimumArea.toLowerCase()}`)}"><span class="unit">${escapeText(copy.ui.units.squareMetre)}</span></div>
      <div class="form-row"><label for="room-${index}-preferred-area">${escapeText(copy.ui.roomPreferredArea)}</label><input id="room-${index}-preferred-area" data-room-index="${index}" data-room-field="preferredAreaM2" inputmode="decimal" value="${escapeAttribute(dimensions.preferredAreaM2)}"><span class="unit">${escapeText(copy.ui.units.squareMetre)}</span></div>
      <div class="form-row"><label for="room-${index}-short-side">${escapeText(copy.ui.roomMinimumShortSide)}</label><input id="room-${index}-short-side" data-room-index="${index}" data-room-field="minShortSideM" inputmode="decimal" value="${escapeAttribute(dimensions.minShortSideM)}"><span class="unit">${escapeText(copy.ui.units.metre)}</span></div>
      <div class="form-row"><label for="room-${index}-min-width">${escapeText(copy.ui.roomMinimumWidth)}</label><input id="room-${index}-min-width" data-room-index="${index}" data-room-field="minWidthM" inputmode="decimal" value="${escapeAttribute(dimensions.minWidthM)}"><span class="unit">${escapeText(copy.ui.units.metre)}</span></div>
      <div class="form-row"><label for="room-${index}-min-depth">${escapeText(copy.ui.roomMinimumDepth)}</label><input id="room-${index}-min-depth" data-room-index="${index}" data-room-field="minDepthM" inputmode="decimal" value="${escapeAttribute(dimensions.minDepthM)}"><span class="unit">${escapeText(copy.ui.units.metre)}</span></div>
      <div class="form-row"><label for="room-${index}-aspect">${escapeText(copy.ui.roomMaxAspectRatio)}</label><input id="room-${index}-aspect" data-room-index="${index}" data-room-field="maxAspectRatio" inputmode="decimal" value="${escapeAttribute(dimensions.maxAspectRatio)}"><span class="unit">${escapeText(copy.ui.units.ratio)}</span></div>
      <label class="check-row"><input type="checkbox" data-room-index="${index}" data-room-trait="exteriorPreference" ${room.traits.exteriorPreference !== "none" ? "checked" : ""}>${escapeText(copy.ui.roomExteriorPreference)}</label>
      <label class="check-row"><input type="checkbox" data-room-index="${index}" data-room-trait="mayBePassThrough" ${room.traits.mayBePassThrough ? "checked" : ""}>${escapeText(copy.ui.roomPassThrough)}</label>
    </div>` : "";
  return `<li class="room-item ${open ? "expanded" : ""}"><div class="room-summary"><span class="room-swatch ${roomKindClass(room.kind)}" aria-hidden="true"></span><input class="room-label" data-room-index="${index}" data-room-field="label" value="${escapeAttribute(room.label)}" aria-label="${escapeAttribute(copy.ui.roomNameAria)}"><input class="quantity-input" data-room-index="${index}" data-room-field="quantity" inputmode="numeric" value="${escapeAttribute(room.quantity)}" aria-label="${escapeAttribute(`${room.label}${copy.ui.roomQuantityAriaSuffix}`)}"><span class="room-area">${escapeText(summary)} ${escapeText(copy.ui.units.squareMetre)}</span><button class="expand-room" type="button" data-expand-room="${escapeAttribute(room.id)}" aria-expanded="${open}" aria-label="${escapeAttribute(`${open ? copy.ui.roomCollapseAria : copy.ui.roomExpandAria} ${room.label}`)}">${open ? "⌃" : "⌄"}</button></div>${advanced}</li>`;
}

function renderRelationships(): string {
  if (editor.draft.relationships.length === 0) return `<p class="empty-note">${escapeText(copy.ui.relationshipEmpty)}</p>`;
  return editor.draft.relationships.map((relationship, index) => `<li class="relationship-item">
    <select data-relationship-index="${index}" data-relationship-field="from" aria-label="${escapeAttribute(`${copy.ui.relationshipFromAriaPrefix} ${index + 1} from`)}">${roomOptions(relationship.from)}</select>
    <select data-relationship-index="${index}" data-relationship-field="kind" aria-label="${escapeAttribute(`${copy.ui.relationshipKindAriaPrefix} ${index + 1} kind`)}">${["mustShareWall", "preferShareWall", "preferNear", "avoidShareWall", "keepSeparate"].map((kind) => `<option value="${kind}" ${relationship.kind === kind ? "selected" : ""}>${escapeText(copy.ui.relationshipKindLabels[kind] ?? kind)}</option>`).join("")}</select>
    <select data-relationship-index="${index}" data-relationship-field="to" aria-label="${escapeAttribute(`${copy.ui.relationshipToAriaPrefix} ${index + 1} to`)}">${roomOptions(relationship.to)}</select>
    <select data-relationship-index="${index}" data-relationship-field="aggregation" aria-label="${escapeAttribute(`${copy.ui.relationshipAggregationAriaPrefix} ${index + 1} aggregation`)}">${["any", "all", "nearest", "average"].map((aggregation) => `<option value="${aggregation}" ${relationship.aggregation === aggregation ? "selected" : ""}>${escapeText(copy.ui.aggregationLabels[aggregation] ?? aggregation)}</option>`).join("")}</select>
    <input data-relationship-index="${index}" data-relationship-field="strength" inputmode="decimal" value="${escapeAttribute(relationship.strength)}" aria-label="${escapeAttribute(`${copy.ui.relationshipStrengthAriaPrefix} ${index + 1} strength`)}" placeholder="${escapeAttribute(copy.ui.relationshipStrengthPlaceholder)}">
  </li>`).join("");
}

function renderBriefPane(state: Readonly<GenerationState>): string {
  const issueMarkup = editor.issues.length > 0
    ? `<p class="form-error" role="alert">${escapeText(issueSummary())}</p>`
    : "";
  const generating = state.status === "generating";
  const storageMarkup = storageNotice === null
    ? ""
    : `<p class="storage-notice" role="status">${escapeText(copy.storage.notices[storageNotice])}</p>`;
  return `<aside class="brief-pane" aria-label="${escapeAttribute(copy.ui.briefTitle)}">
    <div class="brief-scroll">
      <div class="pane-title"><div><span class="eyebrow">${escapeText(copy.ui.briefEyebrow)}</span><h1>${escapeText(copy.ui.briefTitle)}</h1></div><span class="revision">${escapeText(copy.ui.versionPrefix)}${editor.revision + 1}</span></div>
      <section class="brief-section"><h2>${escapeText(copy.sections.site)}</h2>
        <div class="form-row"><label for="project-name">${escapeText(copy.ui.projectName)}</label><input id="project-name" data-draft="name" value="${escapeAttribute(editor.draft.name)}"></div>
        <div class="form-row"><label for="site-width">${escapeText(copy.ui.width)}</label><input id="site-width" data-draft="site.widthM" inputmode="decimal" value="${escapeAttribute(editor.draft.site.widthM)}"><span class="unit">${escapeText(copy.ui.units.metre)}</span></div>
        <div class="form-row"><label for="site-depth">${escapeText(copy.ui.depth)}</label><input id="site-depth" data-draft="site.depthM" inputmode="decimal" value="${escapeAttribute(editor.draft.site.depthM)}"><span class="unit">${escapeText(copy.ui.units.metre)}</span></div>
        <div class="form-row wide-select"><label for="front-side">${escapeText(copy.ui.frontEntrance)}</label><select id="front-side" disabled aria-label="${escapeAttribute(copy.ui.frontSide)}"><option selected>${escapeText(copy.ui.frontSide)}</option></select></div>
        <div class="readout-row"><span>${escapeText(copy.ui.planningGrid)}</span><strong>${GRID_MM} ${escapeText(copy.ui.scaleUnit)}</strong></div>
        <div class="form-row"><label for="generation-seed">${escapeText(copy.ui.variationSeed)}</label><input id="generation-seed" data-draft="generationSeed" value="${escapeAttribute(editor.draft.generationSeed)}"></div>
      </section>
      <section class="brief-section"><h2>${escapeText(copy.sections.offsets)}</h2>${renderOffsetRows()}</section>
      <section class="brief-section"><h2>${escapeText(copy.sections.areaPolicy)}</h2>
        <div class="form-row"><label for="target-gfa">${escapeText(copy.ui.targetGfa)}</label><input id="target-gfa" data-draft="areaPolicy.targetGfaM2" inputmode="decimal" value="${escapeAttribute(editor.draft.areaPolicy.targetGfaM2)}"><span class="unit">${escapeText(copy.ui.units.squareMetre)}</span></div>
        <div class="form-row"><label for="max-gfa">${escapeText(copy.ui.maximumGfa)}</label><input id="max-gfa" data-draft="areaPolicy.maxGfaM2" inputmode="decimal" value="${escapeAttribute(editor.draft.areaPolicy.maxGfaM2)}"><span class="unit">${escapeText(copy.ui.units.squareMetre)}</span></div>
        <div class="form-row"><label for="max-unallocated">${escapeText(copy.ui.maxUnallocated)}</label><input id="max-unallocated" data-draft="areaPolicy.maxUnallocatedInteriorPercent" inputmode="decimal" value="${escapeAttribute(editor.draft.areaPolicy.maxUnallocatedInteriorPercent)}"><span class="unit">${escapeText(copy.ui.units.percent)}</span></div>
      </section>
      <section class="brief-section"><div class="section-heading"><h2>${escapeText(copy.sections.rooms)}</h2><span class="count">${editor.draft.program.length}</span></div>
        <ul class="room-list">${editor.draft.program.map(renderRoom).join("")}</ul>
      </section>
      <section class="brief-section"><h2>${escapeText(copy.sections.relationships)}</h2><ul class="relationship-list">${renderRelationships()}</ul></section>
      <section class="brief-section"><h2>${escapeText(copy.sections.planningAssumptions)}</h2>
        <div class="form-row"><label for="circulation-width">${escapeText(copy.ui.circulationWidth)}</label><input id="circulation-width" data-draft="planning.minimumCirculationWidthM" inputmode="decimal" value="${escapeAttribute(editor.draft.planning.minimumCirculationWidthM)}"><span class="unit">${escapeText(copy.ui.units.metre)}</span></div>
        <div class="readout-row"><span>${escapeText(copy.ui.passThroughPolicy)}</span><strong>${escapeText(copy.ui.passThroughValue)}</strong></div>
        <div class="readout-row"><span>${escapeText(copy.ui.gridResolution)}</span><strong>${editor.draft.planning.gridResolutionMm} ${escapeText(copy.ui.scaleUnit)}</strong></div>
        <p class="helper-text">${escapeText(copy.ui.planningHelper)}</p>
      </section>
      ${issueMarkup}
      ${storageMarkup}
    </div>
    <div class="brief-footer">
      <div class="brief-status" aria-live="polite"><span class="status-dot ${editor.resultsStale ? "warning" : "ok"}" aria-hidden="true"></span><span class="brief-state">${escapeText(statusLabel(state))}</span><span data-live-status>${escapeText(statusDetail(state))}</span></div>
      <div class="editor-actions"><button id="generate" class="primary-action" type="button" ${generating ? "disabled" : ""}>${escapeText(copy.actions.generate)}</button><button id="cancel" type="button" ${generating ? "" : "disabled"}>${escapeText(copy.actions.cancel)}</button><button id="retry" type="button" ${state.status === "workerError" || state.status === "budgetExceeded" ? "" : "disabled"}>${escapeText(copy.actions.retry)}</button></div>
      <div class="text-actions"><button id="discard-draft" class="text-action" type="button" ${editor.dirty ? "" : "disabled"}>${escapeText(copy.actions.discardDraft)}</button><button id="new-variations" class="text-action" type="button" ${generating ? "disabled" : ""}>${escapeText(copy.actions.newVariations)}</button></div>
    </div>
  </aside>`;
}

function viewportKey(project: NormalizedProject): string {
  const site = project.site.site;
  const envelope = project.site.envelope;
  return [project.projectId, site.width, site.depth, envelope.x, envelope.y, envelope.width, envelope.depth].join(":");
}

function syncViewportProject(project: NormalizedProject): void {
  const key = viewportKey(project);
  if (key === viewportProjectKey) return;
  viewportProjectKey = key;
  viewport = createViewportState();
  focusedEvidenceRefs = [];
}

function rootViewBox(project: NormalizedProject): { x: number; y: number; width: number; depth: number } {
  return planViewBox(project);
}

function rootCentre(project: NormalizedProject): { x: number; y: number } {
  const root = rootViewBox(project);
  return { x: root.x + root.width / 2, y: root.y + root.depth / 2 };
}

function updateViewportTransformMarkup(): void {
  const svg = app.querySelector<SVGSVGElement>(".plan-svg");
  const group = svg?.querySelector<SVGGElement>("[data-viewport-transform]");
  if (!svg || !group) return;
  group.setAttribute("transform", viewportTransformAttribute(viewport.transform));
  svg.classList.toggle("pan-mode", viewport.mode === "pan");
  const zoom = app.querySelector<HTMLElement>("[data-zoom-value]");
  if (zoom) zoom.textContent = `${Math.round(viewport.transform.scale * 100)}%`;
}

function svgPointerAnchor(svg: SVGSVGElement, event: PointerEvent | WheelEvent, project: NormalizedProject): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const root = rootViewBox(project);
  return pointerToViewBox(event.clientX, event.clientY, {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }, {
    x: root.x,
    y: root.y,
    width: root.width,
    depth: root.depth,
  });
}

function pointerPanDelta(svg: SVGSVGElement, previous: { clientX: number; clientY: number }, event: PointerEvent, project: NormalizedProject): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const root = rootViewBox(project);
  const basePixelsPerUnit = Math.min(rect.width / root.width, rect.height / root.depth);
  if (!Number.isFinite(basePixelsPerUnit) || basePixelsPerUnit <= 0) return { x: 0, y: 0 };
  return {
    x: (event.clientX - previous.clientX) / basePixelsPerUnit,
    y: (event.clientY - previous.clientY) / basePixelsPerUnit,
  };
}

function bindViewportEvents(): void {
  const svg = app.querySelector<SVGSVGElement>(".plan-svg");
  if (!svg) return;
  const selected = selectedResult(controller.state);
  const project = selected.project;
  const root = rootViewBox(project);
  const setTransform = (next: typeof viewport.transform): void => {
    viewport = { ...viewport, transform: next };
    updateViewportTransformMarkup();
  };
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-viewport-action]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.viewportAction;
      if (action === "select" || action === "pan") {
        viewport = { ...viewport, mode: action };
        render(controller.state);
      } else if (action === "zoom-in") {
        setTransform(zoomViewport(viewport.transform, VIEWPORT_ZOOM_FACTOR, rootCentre(project)));
      } else if (action === "zoom-out") {
        setTransform(zoomViewport(viewport.transform, 1 / VIEWPORT_ZOOM_FACTOR, rootCentre(project)));
      } else if (action === "fit") {
        setTransform(fitViewport(project.site.site, root, { width: svg.clientWidth, height: svg.clientHeight }));
      }
    });
  }
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? VIEWPORT_ZOOM_FACTOR : 1 / VIEWPORT_ZOOM_FACTOR;
    const pointer = svgPointerAnchor(svg, event, project);
    const scale = viewport.transform.scale;
    const anchor = {
      x: (pointer.x - viewport.transform.translateX) / scale,
      y: (pointer.y - viewport.transform.translateY) / scale,
    };
    setTransform(zoomViewport(viewport.transform, direction, anchor));
  }, { passive: false });
  svg.addEventListener("pointerdown", (event) => {
    if (viewport.mode !== "pan" && event.button !== 1) return;
    pointerSession = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("dragging");
  });
  svg.addEventListener("pointermove", (event) => {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
    const delta = pointerPanDelta(svg, pointerSession, event, project);
    pointerSession = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    setTransform(panViewport(viewport.transform, delta.x, delta.y));
  });
  const finishPointer = (event: PointerEvent): void => {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
    pointerSession = null;
    svg.classList.remove("dragging");
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };
  svg.addEventListener("pointerup", finishPointer);
  svg.addEventListener("pointercancel", finishPointer);
  svg.addEventListener("pointerleave", (event) => {
    if (pointerSession && svg.hasPointerCapture(event.pointerId)) return;
    finishPointer(event);
  });
}

function renderCanvas(state: Readonly<GenerationState>): string {
  const selected = selectedResult(state);
  syncViewportProject(selected.project);
  const progress = state.status === "generating" ? progressReadout(state) : copy.ui.canvasReady;
  // The pointer tools are inline SVG rather than glyph characters: the arrow
  // and hand emoji render inconsistently across platforms and font fallbacks,
  // and the mockup shows drawn tool icons.
  const selectIcon = `<svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 1.6l9.4 6.2-4 .6-1.9 3.6z"/></svg>`;
  const panIcon = `<svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.6 13.4c-1.1 0-1.8-.7-1.8-1.8V7.4a.65.65 0 0 1 1.3 0v1.2h.5V4.4a.65.65 0 0 1 1.3 0v4.2h.5V3.7a.65.65 0 0 1 1.3 0v4.9h.5V5a.65.65 0 0 1 1.3 0v5.4c0 1.9-1.1 3-3 3z"/></svg>`;
  return `<section class="canvas" aria-label="${escapeAttribute(copy.ui.viewportAria)}">
    <div class="viewport-tools" role="group" aria-label="${escapeAttribute(copy.ui.viewportToolsAria)}"><button type="button" aria-label="${escapeAttribute(copy.ui.selectTool)}" aria-pressed="${viewport.mode === "select"}" data-viewport-action="select" class="${viewport.mode === "select" ? "active" : ""}">${selectIcon}</button><button type="button" aria-label="${escapeAttribute(copy.ui.panTool)}" aria-pressed="${viewport.mode === "pan"}" data-viewport-action="pan" class="${viewport.mode === "pan" ? "active" : ""}">${panIcon}</button><span class="tool-divider"></span><button type="button" aria-label="${escapeAttribute(copy.ui.zoomOut)}" data-viewport-action="zoom-out">−</button><span class="zoom-value" data-zoom-value>${Math.round(viewport.transform.scale * 100)}%</span><button type="button" aria-label="${escapeAttribute(copy.ui.zoomIn)}" data-viewport-action="zoom-in">+</button><button type="button" class="fit-action" aria-label="${escapeAttribute(copy.ui.fitPlan)}" data-viewport-action="fit">${escapeText(copy.ui.fitPlan)}</button></div>
    <div class="north-indicator" role="img" aria-label="${escapeAttribute(copy.ui.northOrientation)}">${escapeText(copy.ui.northSymbol)}<span>▲</span></div>
    ${projectPlanSvg({ layout: selected.layout, project: selected.project, stale: editor.resultsStale, focusedEvidenceRefs, transform: viewport.transform, copy: copy.ui })}
    <div class="canvas-status" data-live-canvas aria-live="polite">${escapeText(progress)}</div>
    <div class="legend" role="group" aria-label="${escapeAttribute(copy.ui.legendAria)}"><span><i class="legend-line site-line"></i>${escapeText(copy.ui.propertyBoundary)}</span><span><i class="legend-line footprint-line"></i>${escapeText(copy.ui.buildingFootprint)}</span><span><i class="legend-swatch room-line"></i>${escapeText(copy.ui.roomLegend)}</span><span><i class="legend-swatch circulation-line"></i>${escapeText(copy.ui.circulationLegend)}</span></div>
    <div class="entrance-label">${escapeText(copy.ui.entranceLabel)}</div>
  </section>`;
}

/**
 * The empty/partial state of the option row.
 *
 * An infeasible or budget-limited run must say what actually happened instead
 * of reusing the "nothing has been generated yet" prompt, and an infeasible run
 * never keeps a previous brief's cards on screen as if they answered it.
 */
function optionRowEmptyMessage(state: Readonly<GenerationState>): string {
  if (state.status === "infeasible") return copy.status.infeasible;
  if (state.status === "budgetExceeded") return copy.status.budgetExceeded;
  if (state.status === "workerError") return state.error ?? copy.status.workerError;
  if (state.status === "partial" && state.lastCompatibleResult) return copy.status.partial;
  return state.lastCompatibleResult ? copy.status.partial : copy.status.noResult;
}

function renderOptions(selected: ReturnType<typeof selectedResult>, state: Readonly<GenerationState>): string {
  // Before the first run there is nothing to slot, so the row states the
  // situation once.  Once a result exists, the three slots stay visible so an
  // unfilled slot can carry its own reason.
  if (!selected.result) return `<p class="empty-state">${escapeText(optionRowEmptyMessage(state))}</p>`;
  return projectOptionCards(selected.result, selectedLayoutId, selected.project, copy).map((card) => {
    if (!card.layoutId) {
      return `<div class="option-card empty"><span class="option-head"><span class="option-badge">${escapeText(card.slot)}</span><span class="option-name">${escapeText(card.strategyLabel)}</span></span><span class="option-empty-reason">${escapeText(card.emptyReason ?? copy.analysis.optionUnavailable)}</span></div>`;
    }
    return `<button class="option-card ${card.selected ? "selected" : ""}" type="button" data-layout="${escapeAttribute(card.layoutId)}" aria-pressed="${card.selected}"><span class="option-head"><span class="option-badge">${escapeText(card.slot)}</span><span class="option-name">${escapeText(card.strategyLabel)}</span></span><strong class="option-score">${card.score ?? "—"}</strong>${card.thumbnail}</button>`;
  }).join("");
}

function renderRuleChecks(evidence: CandidateEvidence | null, layout: Layout | undefined): string {
  if (!evidence) return "";
  const { failures, warnings, passedCount, notApplicableCount } = evidence.rules;
  const summaryParts = [`${passedCount} ${escapeText(copy.analysis.rulePassSummary)}`];
  if (notApplicableCount > 0) summaryParts.push(`${notApplicableCount} ${escapeText(copy.analysis.ruleNotApplicableSummary)}`);
  const summaryClass = failures.length > 0 ? "fail" : warnings.length > 0 ? "warning" : "pass";
  const summaryStatus = failures.length > 0
    ? copy.analysis.ruleStatusLabels.fail
    : warnings.length > 0 ? copy.analysis.ruleStatusLabels.warning : copy.analysis.ruleStatusLabels.pass;
  const rows = [...failures, ...warnings].map((row: RuleCheckRow) => {
    const status = copy.analysis.ruleStatusLabels[row.status];
    const refs = row.evidenceRefs;
    const hasGeometry = refs.length > 0 && (() => {
      const evidenceGeometry = projectEvidenceGeometry(layout, refs);
      return evidenceGeometry.rects.length > 0;
    })();
    const text = `<span class="rule-label">${escapeText(row.label)}</span><span class="rule-status ${row.status}">${escapeText(status)}</span>`;
    return hasGeometry
      ? `<li class="rule-row ${row.status}"><button type="button" class="rule-button" data-evidence-refs="${escapeAttribute(refs.join("|"))}" aria-pressed="${focusedEvidenceRefs.join("|") === refs.join("|")}">${text}</button></li>`
      : `<li class="rule-row ${row.status}"><span class="rule-button static">${text}</span></li>`;
  }).join("");
  return `<h3>${escapeText(copy.analysis.ruleChecksTitle)}</h3><ul class="rule-checks"><li class="rule-summary ${summaryClass}"><span class="rule-status ${summaryClass}">${escapeText(summaryStatus)}</span><span>${summaryParts.join(" · ")}</span></li>${rows}</ul>`;
}

function renderObservations(
  selected: ReturnType<typeof selectedResult>,
  explanations: GenerationResultPayload["candidates"][number]["scores"][number]["explanations"],
): string {
  const observations = explanations.slice(0, 4).map((explanation) => {
    const refs = explanation.evidenceRefs.filter((reference) => reference.length > 0);
    const hasGeometry = refs.length > 0 && (() => {
      const evidence = projectEvidenceGeometry(selected.layout, refs);
      return evidence.rects.length > 0 || evidence.portals.length > 0;
    })();
    const focused = hasGeometry && focusedEvidenceRefs.join("|") === refs.join("|");
    const label = observationLabel(explanation.key, copy);
    const icon = `<span class="observation-icon ${explanation.impact < 0 ? "weak" : "strong"}" aria-hidden="true">${explanation.impact >= 0 ? "✓" : "!"}</span>`;
    const text = `<span class="observation-text">${escapeText(label)}</span>`;
    const content = hasGeometry
      ? `<button type="button" class="observation-button" data-evidence-refs="${escapeAttribute(refs.join("|"))}" aria-pressed="${focused}" aria-label="${escapeAttribute(`Focus ${label}`)}">${icon}${text}</button>`
      : `<span class="observation-static">${icon}${text}</span>`;
    return `<li class="observation-item ${focused ? "focused" : ""}">${content}</li>`;
  }).join("") ?? "";
  return `<h3>${escapeText(copy.ui.observations)}</h3><ul class="observations">${observations || `<li class="empty-state">${escapeText(copy.ui.noEvidence)}</li>`}</ul>`;
}

function renderAnalysis(state: Readonly<GenerationState>): string {
  const selected = selectedResult(state);
  const evidence = selected.layout ? candidateEvidence(selected.layout, selected.project) : null;
  const scorecard = selectedScorecard(selected.result, selectedLayoutId);
  const heading = scorecard
    ? `${escapeText(copy.ui.optionPrefix)} — ${escapeText(copy.strategyNames[scorecard.strategy] ?? scorecard.label)}`
    : escapeText(copy.ui.analysisFallbackTitle);
  const score = scorecard && Number.isFinite(scorecard.overallScore) ? Math.round(scorecard.overallScore) : null;
  const hasOptions = (selected.result?.selection.selected.length ?? 0) > 0;
  const metricRows = evidence
    ? projectMetricRows(evidence.facts, copy).map((row) => `<div class="metric-row"><span title="${escapeAttribute(row.definition)}">${escapeText(row.label)}</span><strong>${escapeText(row.value ?? "—")}</strong></div>`).join("")
    : "";
  const categoryRows = projectCategoryRows(scorecard, METRIC_CATEGORIES, copy);
  const bars = categoryRows.map((row) => `<div class="score-bar-row"><span>${escapeText(row.label)}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, row.score))}%"></i></span><strong>${row.score}</strong></div>`).join("");
  // Stale results stay visible but never look current: the banner states the
  // problem and offers the one action that fixes it.
  const staleBanner = editor.resultsStale
    ? `<div class="stale-banner" role="status"><span class="stale-mark" aria-hidden="true">!</span><div class="stale-copy"><strong>${escapeText(copy.status.staleLabel)}</strong><span>${escapeText(copy.status.staleResults)}</span></div><button type="button" id="regenerate" class="stale-action">${escapeText(copy.status.staleAction)}</button></div>`
    : "";
  // With no result to describe, the panel states the outcome once instead of
  // printing empty metric, score, rule and observation sections.
  const body = hasOptions
    ? `<div class="analysis-heading"><h2>${heading}</h2>${score === null ? "" : `<strong>${score}<small>/100</small></strong>`}</div>
      <div class="metrics">${metricRows || `<p class="empty-state">${escapeText(copy.ui.noEvidence)}</p>`}</div>
      <h3>${escapeText(copy.ui.scoreBreakdown)}</h3><div class="score-bars">${bars}</div>
      ${renderRuleChecks(evidence, selected.layout)}
      ${renderObservations(selected, observationExplanations(scorecard))}`
    : selected.result
      ? `<p class="empty-state">${escapeText(optionRowEmptyMessage(state))}</p>`
      : "";
  return `<aside class="analysis" aria-label="${escapeAttribute(`${copy.ui.optionsTitle} and ${copy.ui.analysisTitle}`)}"><div class="analysis-scroll"><div class="pane-title"><div><span class="eyebrow">${escapeText(copy.ui.compareEyebrow)}</span><h1>${escapeText(copy.ui.optionsTitle)}</h1></div><span class="count">${selected.result?.selection.selected.length ?? 0}/3</span></div>${staleBanner}<div class="options">${renderOptions(selected, state)}</div>${body}</div><div class="conceptual-notice"><span aria-hidden="true">ⓘ</span><span>${escapeText(copy.status.conceptualUseNotice)}</span></div></aside>`;
}

function preserveFocus(): { id: string | null; start: number | null; end: number | null } {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLButtonElement)) return { id: null, start: null, end: null };
  return {
    id: active.id || active.getAttribute("data-draft") || null,
    start: active instanceof HTMLInputElement ? active.selectionStart : null,
    end: active instanceof HTMLInputElement ? active.selectionEnd : null,
  };
}

function restoreFocus(focus: { id: string | null; start: number | null; end: number | null }): void {
  if (!focus.id) return;
  const target = app.querySelector<HTMLElement>(`#${CSS.escape(focus.id)}, [data-draft="${CSS.escape(focus.id)}"]`);
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement && focus.start !== null && focus.end !== null) {
    target.setSelectionRange(focus.start, focus.end);
  }
}

function updateBrief(patch: Parameters<typeof editBriefDraft>[1]): void {
  editor = editBriefDraft(editor, patch);
}

function commitEditorDraft(): boolean {
  const outcome = commitBriefDraft(editor);
  editor = outcome.state;
  if (outcome.ok) {
    committedProjects.set(editor.revision, editor.committedProject);
    scheduleSave();
  }
  render(controller.state);
  return outcome.ok;
}

/**
 * Debounced local save of the committed brief.
 *
 * The brief is written from `committedBrief` — the authored document — rather
 * than from the normalized solver input, so a stored project reopens as the
 * form the author typed.  A page hide flushes immediately, because a debounce
 * that never fires is a lost project.
 */
function scheduleSave(): void {
  if (projectStore === null || saveState === "unavailable") return;
  if (editor.revision === lastSavedRevision) return;
  if (saveState !== "saving") {
    saveState = "saving";
    renderSaveStatus();
  }
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

function flushSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (projectStore === null) return;
  if (editor.revision === lastSavedRevision && saveState === "saved") return;
  const outcome = projectStore.write(editor.committedBrief);
  if (outcome.status === "saved") {
    saveState = "saved";
    lastSavedRevision = editor.revision;
  } else {
    saveState = "failed";
  }
  renderSaveStatus();
}

function saveStatusText(): string {
  if (saveState === "unavailable") return copy.storage.unavailableLabel;
  if (saveState === "saving") return copy.storage.savingLabel;
  if (saveState === "failed") return copy.storage.failedLabel;
  return copy.storage.savedLabel;
}

/**
 * Update the save indicator in place, without a full re-render.
 *
 * The toolbar is rendered from one template, so this locates the indicator by
 * its class and rewrites only its dot and its label.
 */
function renderSaveStatus(): void {
  const indicator = app.querySelector<HTMLElement>(".save-indicator");
  if (!indicator) return;
  indicator.dataset.state = saveState;
  const dot = indicator.querySelector<HTMLElement>(".status-dot");
  if (dot) dot.classList.toggle("warning", saveState === "failed");
  const label = indicator.querySelector<HTMLElement>("[data-save-status]") ??
    indicator.querySelectorAll<HTMLElement>("span")[1] ?? null;
  if (label) label.textContent = saveStatusText();
}

function roomWithField(index: number, field: keyof DraftRoom, value: string): void {
  updateBrief({
    program: editor.draft.program.map((room, roomIndex) => roomIndex === index ? { ...room, [field]: value } : room),
  });
}

function roomWithDimension(index: number, field: keyof DraftRoom["dimensions"], value: string): void {
  updateBrief({
    program: editor.draft.program.map((room, roomIndex) => roomIndex === index
      ? { ...room, dimensions: { ...room.dimensions, [field]: value } }
      : room),
  });
}

function roomWithTrait(index: number, field: "exteriorPreference" | "mayBePassThrough", checked: boolean): void {
  updateBrief({
    program: editor.draft.program.map((room, roomIndex) => roomIndex === index
      ? { ...room, traits: { ...room.traits, [field]: field === "exteriorPreference" ? (checked ? "high" : "none") : checked } }
      : room),
  });
}

function relationshipWithField(index: number, field: keyof DraftRelationship, value: string): void {
  updateBrief({
    relationships: editor.draft.relationships.map((relationship, relationshipIndex) => relationshipIndex === index
      ? { ...relationship, [field]: value }
      : relationship),
  });
}

function bindFormEvents(): void {
  for (const input of app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-draft]")) {
    const path = input.dataset.draft!;
    const update = (value: string): void => {
      if (path === "name") updateBrief({ name: value });
      else if (path === "site.widthM") updateBrief({ site: { widthM: value } });
      else if (path === "site.depthM") updateBrief({ site: { depthM: value } });
      else if (path === "generationSeed") updateBrief({ generationSeed: value });
      else if (path === "areaPolicy.targetGfaM2") updateBrief({ areaPolicy: { targetGfaM2: value } });
      else if (path === "areaPolicy.maxGfaM2") updateBrief({ areaPolicy: { maxGfaM2: value } });
      else if (path === "areaPolicy.maxUnallocatedInteriorPercent") updateBrief({ areaPolicy: { maxUnallocatedInteriorPercent: value } });
      else if (path === "planning.minimumCirculationWidthM") updateBrief({ planning: { minimumCirculationWidthM: value } });
    };
    input.addEventListener("input", () => update(input.value));
    input.addEventListener("change", () => { update(input.value); commitEditorDraft(); });
  }

  for (const input of app.querySelectorAll<HTMLInputElement>("[data-offset-side]")) {
    const side = input.dataset.offsetSide as CardinalSide;
    const update = (value: string): void => updateBrief({ offsets: { [side]: { distanceM: value } } });
    input.addEventListener("input", () => update(input.value));
    input.addEventListener("change", () => { update(input.value); commitEditorDraft(); });
  }
  for (const select of app.querySelectorAll<HTMLSelectElement>("[data-offset-source]")) {
    const side = select.dataset.offsetSource as CardinalSide;
    select.addEventListener("change", () => {
      updateBrief({ offsets: { [side]: { source: select.value as BriefDraft["offsets"][CardinalSide]["source"] } } });
      commitEditorDraft();
    });
  }
  for (const input of app.querySelectorAll<HTMLInputElement>("[data-room-index][data-room-field]")) {
    const index = Number(input.dataset.roomIndex);
    const field = input.dataset.roomField as keyof DraftRoom;
    const update = (value: string): void => {
      if (field in editor.draft.program[index]!.dimensions) roomWithDimension(index, field as keyof DraftRoom["dimensions"], value);
      else roomWithField(index, field, value);
    };
    input.addEventListener("input", () => update(input.value));
    input.addEventListener("change", () => { update(input.value); commitEditorDraft(); });
  }
  for (const input of app.querySelectorAll<HTMLInputElement>("[data-room-trait]")) {
    const index = Number(input.dataset.roomIndex);
    const field = input.dataset.roomTrait as "exteriorPreference" | "mayBePassThrough";
    input.addEventListener("change", () => { roomWithTrait(index, field, input.checked); commitEditorDraft(); });
  }
  for (const select of app.querySelectorAll<HTMLSelectElement>("[data-relationship-index][data-relationship-field]")) {
    const index = Number(select.dataset.relationshipIndex);
    const field = select.dataset.relationshipField as keyof DraftRelationship;
    select.addEventListener("change", () => { relationshipWithField(index, field, select.value); commitEditorDraft(); });
  }
  for (const input of app.querySelectorAll<HTMLInputElement>("input[data-relationship-index][data-relationship-field]")) {
    const index = Number(input.dataset.relationshipIndex);
    const field = input.dataset.relationshipField as keyof DraftRelationship;
    input.addEventListener("input", () => relationshipWithField(index, field, input.value));
    input.addEventListener("change", () => { relationshipWithField(index, field, input.value); commitEditorDraft(); });
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-expand-room]")) {
    button.addEventListener("click", () => { expandedRoomId = button.dataset.expandRoom === expandedRoomId ? null : button.dataset.expandRoom!; render(controller.state); });
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-layout]")) {
    button.addEventListener("click", () => { selectedLayoutId = button.dataset.layout!; focusedEvidenceRefs = []; render(controller.state); });
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-evidence-refs]")) {
    button.addEventListener("click", () => {
      const raw = button.dataset.evidenceRefs ?? "";
      focusedEvidenceRefs = raw.split("|").filter((reference) => reference.length > 0);
      render(controller.state);
    });
  }
  app.querySelector<HTMLButtonElement>("#generate")?.addEventListener("click", startGeneration);
  app.querySelector<HTMLButtonElement>("#cancel")?.addEventListener("click", () => controller.cancel());
  app.querySelector<HTMLButtonElement>("#retry")?.addEventListener("click", retryGeneration);
  app.querySelector<HTMLButtonElement>("#new-variations")?.addEventListener("click", startVariations);
  app.querySelector<HTMLButtonElement>("#regenerate")?.addEventListener("click", startGeneration);
  app.querySelector<HTMLButtonElement>("#discard-draft")?.addEventListener("click", () => { editor = discardBriefDraft(editor); render(controller.state); });
}

function startGeneration(): void {
  if (!commitEditorDraft()) return;
  // Generating is a natural flush point: the user has committed to this brief.
  flushSave();
  generationRevision = editor.revision;
  focusedEvidenceRefs = [];
  controller.start(editor.committedProject, editor.committedProject.generation.seed);
}

/**
 * Start a run from an explicitly different variation seed.
 *
 * UI_ARCHITECTURE separates "retry" (same seed, same result) from "new
 * variations" (a different seed).  The bump is deterministic, so the sequence
 * of variations is reproducible rather than random.
 */
function startVariations(): void {
  updateBrief({ generationSeed: bumpVariationSeed(editor.draft.generationSeed) });
  startGeneration();
}

/**
 * Live progress readout while a run is in flight.
 *
 * The ticker only rewrites the two status text nodes.  Re-rendering the whole
 * workspace four times a second would throw away focus and scroll position in
 * the middle of an edit, so the DOM is updated in place instead.
 */
let progressTicker: ReturnType<typeof setInterval> | null = null;

function syncProgressTicker(state: Readonly<GenerationState>): void {
  const running = state.status === "generating" && state.startedAt !== null;
  if (!running) {
    if (progressTicker !== null) {
      clearInterval(progressTicker);
      progressTicker = null;
    }
    return;
  }
  if (progressTicker !== null) return;
  progressTicker = setInterval(() => {
    const live = controller.state;
    const canvas = app.querySelector<HTMLElement>("[data-live-canvas]");
    if (canvas) canvas.textContent = progressReadout(live);
    const status = app.querySelector<HTMLElement>("[data-live-status]");
    if (status) status.textContent = statusDetail(live);
  }, 250);
}

function retryGeneration(): void {
  if (!commitEditorDraft()) return;
  generationRevision = editor.revision;
  focusedEvidenceRefs = [];
  // Retry the latest committed snapshot. The controller still supplies the
  // same seed semantics, while this guard prevents a retry after an edit from
  // accidentally re-running an older brief.
  controller.start(editor.committedProject, editor.committedProject.generation.seed);
}

function render(state: Readonly<GenerationState>): void {
  // Promote only a result generated from the current committed snapshot
  // before projecting any pane. A late response remains visible through the
  // old snapshot, but it cannot clear the stale affordance.
  if ((state.status === "complete" || state.status === "partial" || state.status === "infeasible") && state.lastCompatibleResult && generationRevision !== null) {
    const next = markBriefResultCurrent(editor, generationRevision);
    if (next !== editor) {
      editor = next;
      committedProjects.set(editor.revision, editor.committedProject);
    }
  }
  const focus = preserveFocus();
  selectedResult(state);
  // Toolbar glyphs are inline SVG.  Unicode symbol fallbacks (a ruler, a
  // command mark) render as a blank or a hyphen on machines without the
  // expected font, which turned a labelled control into a broken one.
  const toolbarIcon = (name: "brand" | "grid" | "measurements" | "settings"): string => {
    const body: Record<typeof name, string> = {
      brand: `<rect class="brand-plate" x="2" y="2" width="16" height="16" rx="3"/><path d="M6.5 6.5h7v7h-7z"/><path d="M6.5 10h7M10 6.5v7"/>`,
      grid: `<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/>`,
      measurements: `<path d="M2.2 10.6l8.4-8.4 3.6 3.6-8.4 8.4z"/><path d="M5 7.8l1.3 1.3M7 5.8l1.3 1.3M9 3.8l1.3 1.3"/>`,
      settings: `<circle cx="8" cy="8" r="2.3"/><path d="M8 1.6v2.1M8 12.3v2.1M1.6 8h2.1M12.3 8h2.1M3.6 3.6l1.5 1.5M10.9 10.9l1.5 1.5M12.4 3.6l-1.5 1.5M5.1 10.9l-1.5 1.5"/>`,
    };
    return `<svg class="toolbar-icon toolbar-icon-${name}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body[name]}</svg>`;
  };
  // Out-of-scope toolbar actions are present as visibly disabled shell controls
  // rather than as buttons that look live and do nothing.
  const shellControl = (label: string, icon: "grid" | "measurements" | "settings"): string =>
    `<button type="button" class="toolbar-button" disabled title="${escapeAttribute(`${label} — ${copy.toolbar.disabledReason}`)}">${toolbarIcon(icon)}<span>${escapeText(label)}</span></button>`;
  app.innerHTML = `<header class="toolbar"><div class="brand"><span class="brand-mark" aria-hidden="true">${toolbarIcon("brand")}</span><strong>${escapeText(copy.productName)}</strong><span class="brand-subtitle">${escapeText(copy.subtitle)}</span></div><div class="toolbar-group toolbar-middle"><button type="button" class="toolbar-button" disabled title="${escapeAttribute(`${copy.toolbar.newProject} — ${copy.toolbar.disabledReason}`)}">${escapeText(copy.toolbar.newProject)}</button><span class="save-indicator"><span class="status-dot ok" aria-hidden="true"></span>${escapeText(copy.toolbar.saveStatus)}</span></div><div class="toolbar-group toolbar-right">${shellControl(copy.toolbar.grid, "grid")}${shellControl(copy.toolbar.measurements, "measurements")}${shellControl(copy.toolbar.settings, "settings")}</div></header><main class="workspace">${renderBriefPane(state)}${renderCanvas(state)}${renderAnalysis(state)}</main>`;
  bindFormEvents();
  bindViewportEvents();
  renderSaveStatus();
  restoreFocus(focus);
  syncProgressTicker(state);
}

controller.subscribe(render);

// A debounced save that never fires is a lost project, so hide/unload flush
// immediately.  `pagehide` fires on refresh, tab close and bfcache entry.
window.addEventListener("pagehide", () => flushSave());
window.addEventListener("beforeunload", () => flushSave());
