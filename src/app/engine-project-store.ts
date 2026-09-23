/**
 * Browser-local cache for the new engine workflow: only a navigation pointer and
 * the unsaved draft live here. SQLite on the service is authoritative for saved
 * briefs, jobs, layouts and the selected option. Legacy `planlab:v1:*` keys are
 * never written or removed here.
 */
import type { EngineEditorState } from "./engine-editor-state.ts";

export const POINTER_KEY = "planlab:v2:lastProjectId";
export const DRAFT_SCHEMA_VERSION = "planlab.draft/2" as const;

export interface StoredDraft {
  schemaVersion: typeof DRAFT_SCHEMA_VERSION;
  projectId: string;
  baseBriefVersionId: string | null;
  updatedAt: string;
  draft: EngineEditorState;
}

export function draftKey(projectId: string): string {
  return `planlab:v2:draft:${projectId}`;
}

function storageOrNull(storage?: Storage | null): Storage | null {
  if (storage) {
    return storage;
  }
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // storage denied by the browser
  }
}

export function savePointer(projectId: string, storage?: Storage | null): boolean {
  const target = storageOrNull(storage);
  if (!target) {
    return false;
  }
  try {
    target.setItem(POINTER_KEY, projectId);
    return true;
  } catch {
    return false; // storage refusal must never block server saving
  }
}

export function loadPointer(storage?: Storage | null): string | null {
  const target = storageOrNull(storage);
  if (!target) {
    return null;
  }
  try {
    return target.getItem(POINTER_KEY);
  } catch {
    return null;
  }
}

export function clearPointer(storage?: Storage | null): void {
  const target = storageOrNull(storage);
  try {
    target?.removeItem(POINTER_KEY);
  } catch {
    /* ignore */
  }
}

export function saveDraft(
  projectId: string,
  draft: EngineEditorState,
  baseBriefVersionId: string | null,
  storage?: Storage | null,
  now = new Date(),
): boolean {
  const target = storageOrNull(storage);
  if (!target) {
    return false;
  }
  const payload: StoredDraft = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    projectId,
    baseBriefVersionId,
    updatedAt: now.toISOString().replace(/\.\d+Z$/, "Z"),
    draft,
  };
  try {
    target.setItem(draftKey(projectId), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(
  projectId: string,
  storage?: Storage | null,
): StoredDraft | null {
  const target = storageOrNull(storage);
  if (!target) {
    return null;
  }
  let raw: string | null;
  try {
    raw = target.getItem(draftKey(projectId));
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed.schemaVersion !== DRAFT_SCHEMA_VERSION || parsed.projectId !== projectId) {
      return null;
    }
    if (!parsed.draft || typeof parsed.draft !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null; // corrupt draft: ignore it, the server copy is authoritative
  }
}

export function clearDraft(projectId: string, storage?: Storage | null): void {
  const target = storageOrNull(storage);
  try {
    target?.removeItem(draftKey(projectId));
  } catch {
    /* ignore */
  }
}

/**
 * A stored draft is only offered when it was written against the version the
 * server still has as current; never silently overwrite a newer brief.
 */
export function draftIsCurrent(
  draft: StoredDraft,
  serverBriefVersionId: string | null,
): boolean {
  return draft.baseBriefVersionId === serverBriefVersionId;
}
