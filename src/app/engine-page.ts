/**
 * The exact engine page: Land / Walls / Rooms / Review editing, a real generate
 * round trip through the local service, and generated options rendered from the
 * returned LayoutV1 DTOs. Deliberately separate from the legacy grid page so the
 * old worker path stays intact for its own tests while this page is the product
 * integration surface.
 */
import type { BriefV1, JobV1, LayoutV1, ProblemV1, RoomType } from "../integration/contracts.ts";
import { ProjectClient } from "../integration/project-client.ts";
import { GenerationController, type GenerationControllerState } from "../integration/generation-controller.ts";
import {
  addRoomInstance,
  compileEditorState,
  createEngineEditorState,
  orderedRooms,
  patchEditorState,
  removeRoomInstance,
  setGroupClass,
  setRoomField,
  type EngineEditorState,
} from "./engine-editor-state.ts";
import { renderLayoutSvg, omittedRoomSummary, optionCaption } from "./engine-svg-projection.ts";
import { ROOM_TYPES, DEFAULT_WALLS } from "./room-policy.ts";
import {
  draftIsCurrent,
  loadDraft,
  loadLastGeneration,
  loadPointer,
  saveDraft,
  saveLastGeneration,
  savePointer,
} from "./engine-project-store.ts";
import { importLegacyProject } from "../integration/legacy-import.ts";
import { buildDebugSections, debugEnabled } from "./generation-debug.ts";

const LEGACY_KEY = "planlab:v1:project";

export interface EnginePageHooks {
  client?: ProjectClient;
  storage?: Storage | null;
}

interface PageState {
  editor: EngineEditorState;
  projectId: string | null;
  projectRevision: number;
  briefVersionId: string | null;
  briefHash: string | null;
  selectedLayoutId: string | null;
  issues: { path: string; message: string }[];
  lastError: string | null;
  legacyNotices: string[];
  busy: "idle" | "saving" | "generating";
  notice: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((accumulator, part, index) => {
    const value = index < values.length ? values[index] : "";
    return accumulator + part + String(value);
  }, "");
}

export function mountEnginePage(root: HTMLElement, hooks: EnginePageHooks = {}): void {
  const client = hooks.client ?? new ProjectClient({ baseUrl: "" });
  const storage = hooks.storage === undefined ? safeStorage() : hooks.storage;
  const state: PageState = {
    editor: createEngineEditorState(),
    projectId: null,
    projectRevision: 1,
    briefVersionId: null,
    briefHash: null,
    selectedLayoutId: null,
    issues: [],
    lastError: null,
    legacyNotices: [],
    busy: "idle",
    notice: null,
  };

  let controllerState: GenerationControllerState = {
    status: "idle",
    job: null,
    problem: null,
    connectivity: "online",
    layouts: [],
    stale: false,
    elapsedMs: 0,
  };

  const controller = new GenerationController({
    client,
    onChange: (next) => {
      controllerState = next;
      render();
    },
  });

  function safeStorage(): Storage | null {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }

  function render(): void {
    const rooms = orderedRooms(state.editor);
    const compiled = compileEditorState(state.editor);
    const issuesToShow = state.issues.length > 0
      ? state.issues
      : (compiled.ok ? [] : compiled.issues);
    const progress = controllerState.job
      ? `${controllerState.status} · ${(controllerState.elapsedMs / 1000).toFixed(1)} s`
      : "idle";
    root.innerHTML = html`
      <style>${ENGINE_CSS}</style>
      <header class="toolbar">
        <h1>PlanLab — exact engine</h1>
        <div class="status" data-status>${escapeHtml(progress)}</div>
        <div class="connectivity" data-connectivity>${controllerState.connectivity === "online" ? "" : "service unreachable — retrying"}</div>
      </header>
      <main class="layout">
        <section class="editor">
          <fieldset><legend>Land</legend>
            <label>Site width (m)
              <input id="site-width" data-field="siteWidthM" value="${escapeHtml(state.editor.siteWidthM)}" />
            </label>
            <label>Site depth (m)
              <input id="site-depth" data-field="siteDepthM" value="${escapeHtml(state.editor.siteDepthM)}" />
            </label>
            <label>Front
              <select id="front" data-field="front">
                ${["north", "east", "south", "west"]
                  .map((side) => `<option value="${side}"${side === state.editor.front ? " selected" : ""}>${side}</option>`)
                  .join("")}
              </select>
            </label>
            ${(["north", "east", "south", "west"] as const)
              .map((side) => html`<label>${side} setback (m)
                <input id="setback-${side}" data-setback="${side}" value="${escapeHtml(state.editor.setbacksM[side])}" />
              </label>`)
              .join("")}
          </fieldset>
          <fieldset><legend>Walls and circulation</legend>
            <label>External wall (mm)
              <input id="wall-external" data-field="externalWallMm" value="${escapeHtml(state.editor.externalWallMm)}" />
            </label>
            <label>Internal wall (mm)
              <input id="wall-internal" data-field="internalWallMm" value="${escapeHtml(state.editor.internalWallMm)}" />
            </label>
            <label>Corridor minimum (mm)
              <input id="corridor-width" data-field="circulationMinWidthMm" value="${escapeHtml(state.editor.circulationMinWidthMm)}" />
            </label>
            <label>Door width (mm)
              <input id="door-width" data-field="doorMinWidthMm" value="${escapeHtml(state.editor.doorMinWidthMm)}" />
            </label>
          </fieldset>
          <fieldset><legend>Rooms</legend>
            <div class="add-room">
              <select id="add-room-type">
                ${ROOM_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
              </select>
              <button type="button" data-action="add-room">Add room</button>
            </div>
            <div class="room room-head" aria-hidden="true">
              <span class="room-id">room</span>
              <span class="wide" title="readable name shown in the plan">name</span>
              <span title="area the solver aims for, in square metres">target m²</span>
              <span title="smallest acceptable area, in square metres">min m²</span>
              <span title="largest acceptable area, in square metres">max m²</span>
              <span title="minimum width on the east axis, in millimetres">min width mm</span>
              <span title="minimum height on the north axis, in millimetres">min height mm</span>
            </div>
            ${state.editor.groups.map((group) => renderGroup(group, rooms)).join("")}
          </fieldset>
          <fieldset><legend>Review</legend>
            <div class="review" data-review>
              <p>${rooms.length} room nodes · ${escapeHtml(state.editor.siteWidthM)} m × ${escapeHtml(state.editor.siteDepthM)} m ·
                 external ${escapeHtml(state.editor.externalWallMm)} mm / internal ${escapeHtml(state.editor.internalWallMm)} mm</p>
              <ul>
                ${rooms
                  .map((room) => `<li>${escapeHtml(room.id)} — ${escapeHtml(room.label)} (${room.type}${room.required ? "" : ", optional"}):
                    target ${escapeHtml(room.targetAreaM2)} m², min ${escapeHtml(room.minAreaM2)} m²,
                    min width ${escapeHtml(room.minWidthMm)} mm, min height ${escapeHtml(room.minHeightMm)} mm</li>`)
                  .join("")}
              </ul>
              ${issuesToShow.length === 0
                ? `<p data-compiled="ok">Canonical brief compiles: ${rooms.length} rooms ready to submit.</p>`
                : `<ul data-compiled="issues" class="issues">${issuesToShow
                    .map((issue) => `<li>${escapeHtml(issue.path)}: ${escapeHtml(issue.message)}</li>`)
                    .join("")}</ul>`}
              ${state.legacyNotices.length
                ? `<ul class="issues" data-legacy-notices>${state.legacyNotices.map((notice) => `<li>${escapeHtml(notice)}</li>`).join("")}</ul>`
                : ""}
              ${state.notice ? `<p data-notice>${escapeHtml(state.notice)}</p>` : ""}
            </div>
            <div class="actions">
              <button type="button" id="generate" data-action="generate"
                ${state.busy === "idle" && compiled.ok ? "" : "disabled"}>Generate</button>
              <button type="button" data-action="cancel" ${controllerState.job && !isTerminalStatus(controllerState.status) ? "" : "disabled"}>Cancel</button>
            </div>
          </fieldset>
        </section>
        <section class="options" data-options>
          <h2>Options</h2>
          ${controllerState.problem ? renderProblem(controllerState.problem) : ""}
          ${controllerState.stale ? `<p class="stale" data-stale>These results belong to an older brief. Generate again to refresh.</p>` : ""}
          ${controllerState.layouts.length === 0 && !controllerState.problem
            ? `<p class="empty" data-options-empty>${controllerState.status === "idle" ? "No options yet." : "Waiting for a validated layout…"}</p>`
            : controllerState.layouts.map((layout) => renderOption(layout)).join("")}
        </section>
      </main>
    `;
  }

  function renderGroup(group: EngineEditorState["groups"][number], rooms: ReturnType<typeof orderedRooms>): string {
    const instances = group.instanceIds
      .map((id) => rooms.find((room) => room.id === id))
      .filter(Boolean) as ReturnType<typeof orderedRooms>;
    return html`
      <div class="group" data-group="${escapeHtml(group.requirementId)}">
        <div class="group-head">
          <strong>${escapeHtml(group.label)}</strong>
          <span class="type">${group.type}</span>
          <label>class
            <select data-group-class="${escapeHtml(group.requirementId)}">
              ${["compact", "standard", "spacious"]
                .map((name) => `<option value="${name}"${name === group.roomClass ? " selected" : ""}>${name}</option>`)
                .join("")}
            </select>
          </label>
          <label>optional
            <input type="checkbox" data-group-optional="${escapeHtml(group.requirementId)}" ${group.required ? "" : "checked"} />
          </label>
          <button type="button" data-action="remove-room" data-requirement="${escapeHtml(group.requirementId)}"
            ${group.instanceIds.length > 1 ? "" : "disabled"}>Remove</button>
          <button type="button" data-action="add-room" data-requirement="${escapeHtml(group.requirementId)}">Add</button>
        </div>
        ${instances
          .map((room) => html`
            <div class="room" data-room="${escapeHtml(room.id)}">
              <span class="room-id">${escapeHtml(room.id)}</span>
              <input class="wide" data-room-field="label" data-room-id="${escapeHtml(room.id)}" value="${escapeHtml(room.label)}" aria-label="name for ${escapeHtml(room.id)}" title="room name" />
              <input data-room-field="targetAreaM2" data-room-id="${escapeHtml(room.id)}" value="${escapeHtml(room.targetAreaM2)}" aria-label="target area for ${escapeHtml(room.id)}" />
              <input data-room-field="minAreaM2" data-room-id="${escapeHtml(room.id)}" value="${escapeHtml(room.minAreaM2)}" aria-label="minimum area for ${escapeHtml(room.id)}" />
              <input data-room-field="maxAreaM2" data-room-id="${escapeHtml(room.id)}" value="${escapeHtml(room.maxAreaM2)}" aria-label="maximum area for ${escapeHtml(room.id)}" />
              <input data-room-field="minWidthMm" data-room-id="${escapeHtml(room.id)}" value="${escapeHtml(room.minWidthMm)}" aria-label="minimum width for ${escapeHtml(room.id)}" />
              <input data-room-field="minHeightMm" data-room-id="${escapeHtml(room.id)}" value="${escapeHtml(room.minHeightMm)}" aria-label="minimum height for ${escapeHtml(room.id)}" />
            </div>`)
          .join("")}
      </div>`;
  }

  function renderProblem(problem: ProblemV1): string {
    return html`
      <div class="problem" data-problem data-code="${escapeHtml(problem.code)}" data-category="${escapeHtml(problem.category)}">
        <strong>${escapeHtml(problem.code)}</strong>
        <p>${escapeHtml(problem.message)}</p>
        ${problem.remediation.length
          ? `<ul>${problem.remediation.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")}</ul>`
          : ""}
        <small>${problem.retryable ? "This can be retried." : "Retrying will not change this outcome."}${
          problem.proof ? ` Proof: ${escapeHtml(problem.proof)}.` : ""}</small>
      </div>`;
  }

  function renderOption(layout: LayoutV1): string {
    const selected = layout.layoutId === state.selectedLayoutId;
    const omitted = omittedRoomSummary(layout);
    return html`
      <article class="option${selected ? " selected" : ""}" data-layout-id="${escapeHtml(layout.layoutId)}" data-option-rank="${layout.rank}">
        <header>
          <h3>${escapeHtml(optionCaption(layout))}</h3>
          ${selected ? `<span data-selected-marker>Selected</span>` : ""}
        </header>
        <div class="plan" data-plan>${renderLayoutSvg(layout, { showGrid: false })}</div>
        <ul class="facts">
          <li>${layout.rooms.length} rooms · ${layout.walls.length} walls · ${layout.openings.length} openings</li>
          <li>circulation ${layout.circulation.measuredMinWidthMm} mm · checks ${layout.validation.checks.length} passed</li>
          ${omitted.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
        <div class="analysis" data-analysis>
          <h4>Engine scores (0–1)</h4>
          <ul class="scores">
            ${([
              ["final", layout.scores.final],
              ["topology", layout.scores.topology],
              ["geometry", layout.scores.geometry],
              ["circulation", layout.scores.circulation],
              ["preference", layout.scores.preference],
              ["constraint", layout.scores.constraint],
            ] as const)
              .map(([name, value]) => `<li data-score="${name}">${name}: ${value.toFixed(3)}</li>`)
              .join("")}
          </ul>
          <h4>Independent checks (${layout.validation.checks.length})</h4>
          <ul class="checks">
            ${layout.validation.checks
              .map((check) => `<li data-check="${escapeHtml(check.id)}">${escapeHtml(check.id)} — ${escapeHtml(check.name)}: pass</li>`)
              .join("")}
          </ul>
          <small>Generated and validated by this engine. Ranking is the engine's ordering, not architectural truth.</small>
        </div>
        <button type="button" data-action="use-option" data-layout-id="${escapeHtml(layout.layoutId)}">Use this option</button>
      </article>`;
  }

  function isTerminalStatus(status: string): boolean {
    return ["COMPLETED", "INFEASIBLE", "FAILED", "CANCELLED"].includes(status);
  }

  function persist(): void {
    if (state.projectId) {
      savePointer(state.projectId, storage);
      saveDraft(state.projectId, state.editor, state.briefVersionId, storage);
    }
  }

  async function generate(): Promise<void> {
    state.issues = [];
    state.notice = null;
    const compiled = compileEditorState(state.editor);
    if (!compiled.ok) {
      state.issues = compiled.issues;
      render();
      return;
    }
    state.busy = "saving";
    render();
    try {
      if (!state.projectId) {
        const project = await client.createProject(state.editor.name);
        state.projectId = project.projectId;
        state.projectRevision = project.revision;
      }
      const saved = await client.saveBriefVersion(
        state.projectId,
        state.projectRevision,
        compiled.brief,
        compiled.document,
      );
      state.briefVersionId = saved.briefVersionId;
      state.briefHash = saved.briefHash;
      state.projectRevision = saved.projectRevision;
      persist();
      state.busy = "generating";
      render();
      const jobId = await controller.generate(
        state.projectId,
        saved.briefVersionId,
        saved.briefHash,
        `ui-${state.projectId}-${Date.now()}`,
      );
      if (jobId) {
        saveLastGeneration(state.projectId, jobId, storage);
      }
    } catch (error) {
      const problem = (error as { problem?: ProblemV1 }).problem ?? null;
      state.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      state.issues = problem
        ? [{ path: problem.code, message: problem.message }]
        : [{ path: "network", message: "the local generation service is unreachable" }];
    } finally {
      state.busy = "idle";
      render();
    }
  }

  async function useOption(layoutId: string): Promise<void> {
    if (!state.projectId) {
      return;
    }
    try {
      const selection = await client.putSelection(state.projectId, layoutId, state.projectRevision);
      state.selectedLayoutId = selection.layoutId;
      state.projectRevision = selection.projectRevision;
      state.notice = "Selection saved on the server.";
    } catch (error) {
      const problem = (error as { problem?: ProblemV1 }).problem ?? null;
      state.notice = problem ? `${problem.code}: ${problem.message}` : "selection could not be saved";
    }
    render();
  }

  async function restore(): Promise<void> {
    const pointer = loadPointer(storage);
    if (!pointer) {
      loadLegacyIfPresent();
      return;
    }
    try {
      const detail = await client.getProject(pointer);
      state.projectId = detail.projectId;
      state.projectRevision = detail.revision;
      state.briefVersionId = detail.currentBriefVersionId;
      state.selectedLayoutId = detail.selectedLayoutId;
      if (detail.brief) {
        state.editor = editorFromBrief(detail.brief, detail.editorDocument ?? null);
        state.briefHash = null;
      }
      const draft = loadDraft(pointer, storage);
      if (draft && draftIsCurrent(draft, detail.currentBriefVersionId)) {
        state.editor = draft.draft;
        state.notice = "Restored your unsaved draft.";
      }
      if (detail.activeGenerationId) {
        await controller.reconcile(detail.activeGenerationId);
      } else {
        // alternatives from the last generation stay available across reloads
        const lastGeneration = loadLastGeneration(pointer, storage);
        if (lastGeneration) {
          try {
            const payload = await client.getLayouts(lastGeneration);
            controllerState = { ...controllerState, status: payload.status, layouts: payload.layouts };
          } catch {
            /* the saved generation is gone; the selection alone is still shown */
          }
        }
      }
    } catch {
      state.notice = "saved project could not be loaded; the local service may be offline";
    }
    render();
  }

  function loadLegacyIfPresent(): void {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(LEGACY_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (!raw) {
      return;
    }
    const imported = importLegacyProject(raw);
    state.editor = imported.state;
    state.legacyNotices = imported.unsupported.map((item) => `${item.path}: ${item.message}`);
  }

  function editorFromBrief(brief: BriefV1, document: unknown): EngineEditorState {
    const base = createEngineEditorState([]);
    base.name = brief.rooms[0]?.label ? "Saved project" : "Saved project";
    base.siteWidthM = String(Number((brief.site.widthMm / 1000).toFixed(3)));
    base.siteDepthM = String(Number((brief.site.heightMm / 1000).toFixed(3)));
    base.front = brief.site.front;
    base.setbacksM = {
      north: String(Number((brief.setbacks.northMm / 1000).toFixed(3))),
      east: String(Number((brief.setbacks.eastMm / 1000).toFixed(3))),
      south: String(Number((brief.setbacks.southMm / 1000).toFixed(3))),
      west: String(Number((brief.setbacks.westMm / 1000).toFixed(3))),
    };
    base.externalWallMm = String(brief.walls.externalMm);
    base.internalWallMm = String(brief.walls.internalMm);
    base.circulationMinWidthMm = String(brief.circulation.minWidthMm);
    base.doorMinWidthMm = String(brief.doors.minWidthMm);
    const groups = new Map<string, EngineEditorState["groups"][number]>();
    for (const room of brief.rooms) {
      const key = room.sourceRequirementId;
      const group = groups.get(key) ?? {
        requirementId: key,
        label: room.label,
        type: room.type,
        roomClass: room.roomClass,
        quantity: 0,
        required: room.required,
        instanceIds: [],
        retiredInstanceIds: [],
      };
      group.instanceIds.push(room.id);
      group.quantity = group.instanceIds.length;
      groups.set(key, group);
      base.rooms[room.id] = {
        id: room.id,
        label: room.label,
        type: room.type,
        roomClass: room.roomClass,
        sourceRequirementId: room.sourceRequirementId,
        ordinal: room.ordinal,
        required: room.required,
        targetAreaM2: String(room.targetAreaM2),
        minAreaM2: String(room.minAreaM2),
        maxAreaM2: String(room.maxAreaM2),
        minShortSideMm: String(room.minShortSideMm),
        minWidthMm: String(room.minWidthMm),
        minHeightMm: String(room.minHeightMm),
        maxAspectRatio: String(room.maxAspectRatio),
      };
    }
    base.groups = [...groups.values()];
    base.relationships = brief.relationships.map((rel) => ({
      id: rel.id,
      a: rel.a,
      b: rel.b,
      kind: rel.kind,
      minSharedWallMm: String(rel.minSharedWallMm),
      minOpeningWidthMm: String(rel.minOpeningWidthMm),
    }));
    if (document && typeof document === "object" && "roomGroups" in (document as object)) {
      const groupsDocument = (document as { roomGroups?: EngineEditorState["groups"] }).roomGroups;
      if (Array.isArray(groupsDocument) && groupsDocument.length === base.groups.length) {
        base.groups = groupsDocument.map((group) => ({ ...group }));
      }
    }
    return base;
  }

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.dataset.field) {
      const field = target.dataset.field as "siteWidthM" | "siteDepthM" | "front"
        | "externalWallMm" | "internalWallMm" | "circulationMinWidthMm" | "doorMinWidthMm";
      state.editor = patchEditorState(state.editor, { [field]: target.value } as never);
      persist();
      return;
    }
    if (target.dataset.setback) {
      const side = target.dataset.setback as "north" | "east" | "south" | "west";
      state.editor = patchEditorState(state.editor, {
        setbacksM: { ...state.editor.setbacksM, [side]: target.value },
      });
      persist();
      return;
    }
    if (target.dataset.roomField && target.dataset.roomId) {
      state.editor = setRoomField(state.editor, target.dataset.roomId, target.dataset.roomField as never, target.value);
      persist();
    }
  });

  root.addEventListener("change", async (event) => {
    const target = event.target as HTMLSelectElement | HTMLInputElement;
    // committing a field (blur/enter) re-renders so Review shows the exact value
    if (target.dataset.field) {
      const field = target.dataset.field as "siteWidthM" | "siteDepthM" | "front"
        | "externalWallMm" | "internalWallMm" | "circulationMinWidthMm" | "doorMinWidthMm";
      state.editor = patchEditorState(state.editor, { [field]: target.value } as never);
      persist();
      render();
      return;
    }
    if (target.dataset.setback) {
      const side = target.dataset.setback as "north" | "east" | "south" | "west";
      state.editor = patchEditorState(state.editor, {
        setbacksM: { ...state.editor.setbacksM, [side]: target.value },
      });
      persist();
      render();
      return;
    }
    if (target.dataset.roomField && target.dataset.roomId) {
      state.editor = setRoomField(state.editor, target.dataset.roomId,
        target.dataset.roomField as never, target.value);
      persist();
      render();
      return;
    }
    if (target.dataset.groupClass) {
      state.editor = setGroupClass(
        state.editor,
        target.dataset.groupClass,
        target.value as "compact" | "standard" | "spacious",
      );
      persist();
      render();
      return;
    }
    if (target.dataset.groupOptional) {
      const checked = (target as HTMLInputElement).checked;
      const group = state.editor.groups.find((entry) => entry.requirementId === target.dataset.groupOptional);
      if (group) {
        group.required = !checked;
        for (const id of group.instanceIds) {
          state.editor.rooms[id].required = group.required;
        }
        state.editor = patchEditorState(state.editor, {});
        persist();
        render();
      }
      return;
    }
    if (target.id === "front") {
      render();
    }
  });

  root.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    if (action === "add-room") {
      const requirement = button.dataset.requirement;
      if (requirement) {
        state.editor = addRoomInstance(state.editor, requirement);
      } else {
        const select = root.querySelector<HTMLSelectElement>("#add-room-type");
        const type = (select?.value ?? "store") as RoomType;
        const existing = state.editor.groups.find((group) => group.type === type);
        if (existing) {
          state.editor = addRoomInstance(state.editor, existing.requirementId);
        } else {
          state.editor = patchEditorState(state.editor, {});
          state.editor.groups.push({
            requirementId: type,
            label: type,
            type,
            roomClass: "standard",
            quantity: 0,
            required: false,
            instanceIds: [],
            retiredInstanceIds: [],
          });
          state.editor = addRoomInstance(state.editor, type);
        }
      }
      persist();
      render();
      return;
    }
    if (action === "remove-room" && button.dataset.requirement) {
      const result = removeRoomInstance(state.editor, button.dataset.requirement);
      state.editor = result.state;
      if (result.droppedRelationships.length) {
        state.notice = `removed ${result.removedRoomId}; dropped relationships: ${result.droppedRelationships.join(", ")}`;
      }
      persist();
      render();
      return;
    }
    if (action === "generate") {
      await generate();
      return;
    }
    if (action === "cancel") {
      await controller.cancel();
      return;
    }
    if (action === "use-option" && button.dataset.layoutId) {
      await useOption(button.dataset.layoutId);
    }
  });

  // minimal page-level hooks so a browser driver can assert real state
  (window as unknown as { __planlabEngine?: unknown }).__planlabEngine = {
    state: () => ({
      projectId: state.projectId,
      jobId: controllerState.job?.generationId ?? null,
      status: controllerState.status,
      layouts: controllerState.layouts.length,
      selectedLayoutId: state.selectedLayoutId,
      problem: controllerState.problem?.code ?? null,
      rooms: orderedRooms(state.editor).length,
      busy: state.busy,
      notice: state.notice,
      issues: state.issues.length,
      firstIssue: state.issues[0]?.message ?? null,
      lastError: state.lastError,
    }),
    debug: () => buildDebugSections(controllerState.job, controllerState.layouts, controllerState.problem, null),
    debugEnabled: () => debugEnabled(window.location.search),
  };

  render();
  void restore();
}

const ENGINE_CSS = `
  :root { color-scheme: light; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #f5f3ee; color: #26241f; }
  .toolbar { display: flex; gap: 16px; align-items: baseline; padding: 12px 20px; background: #26241f; color: #f5f3ee; }
  .toolbar h1 { font-size: 16px; margin: 0; }
  .connectivity { color: #ffb27a; }
  .layout { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.4fr); gap: 16px; padding: 16px; align-items: start; }
  .editor { display: grid; gap: 12px; }
  fieldset { border: 1px solid #d8d2c6; border-radius: 10px; background: #fff; padding: 12px; }
  legend { font-weight: 600; padding: 0 6px; }
  label { display: inline-flex; flex-direction: column; gap: 4px; margin: 4px 10px 4px 0; font-size: 12px; color: #5c574c; }
  input, select { font: inherit; padding: 4px 6px; border: 1px solid #c9c2b4; border-radius: 6px; min-width: 84px; }
  button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #26241f; background: #26241f; color: #fff; cursor: pointer; }
  button[disabled] { opacity: 0.45; cursor: not-allowed; }
  .group { border-top: 1px solid #eee9df; padding: 8px 0; }
  .group-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .room { display: flex; gap: 6px; align-items: center; padding: 3px 0; }
  .room input { width: 92px; }
  .room input.wide { width: 132px; }
  .room-id { font-weight: 600; width: 52px; }
  .room-head { color: #6a6459; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .room-head span { width: 92px; }
  .room-head span.wide { width: 132px; }
  .room-head span:first-child { width: 52px; }
  .issues { color: #a33c14; }
  .actions { display: flex; gap: 8px; margin-top: 8px; }
  .options { display: grid; gap: 16px; }
  .option { border: 1px solid #d8d2c6; border-radius: 10px; background: #fff; padding: 12px; }
  .option.selected { outline: 3px solid #4b6b2f; }
  .option h3 { margin: 0 0 8px; font-size: 14px; }
  .plan svg { width: 100%; height: auto; background: #fff; border-radius: 8px; }
  .facts { margin: 8px 0; padding-left: 18px; color: #5c574c; }
  .analysis { border-top: 1px solid #eee9df; margin-top: 8px; padding-top: 8px; }
  .analysis h4 { margin: 8px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #6a6459; }
  .scores, .checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 12px; color: #45413a; }
  .checks { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .problem { border-left: 4px solid #a33c14; background: #fdf3ec; padding: 10px; border-radius: 8px; }
  .stale { background: #fff6d8; padding: 8px; border-radius: 8px; }
  .empty { color: #6a6459; }
`;
