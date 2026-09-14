import type { GenerationBudget, GenerationProgress } from "../domain/generator.ts";
import type { GenerationResultPayload } from "../domain/resultPayload.ts";

export const WORKER_PROTOCOL_VERSION = "planlab-worker-1";

export interface GenerateRequest {
  version: typeof WORKER_PROTOCOL_VERSION;
  kind: "generate";
  requestId: string;
  project: unknown;
  seed: string;
  budget?: Partial<GenerationBudget>;
  cancellationBuffer?: SharedArrayBuffer;
}

export interface CancelRequest {
  version: typeof WORKER_PROTOCOL_VERSION;
  kind: "cancel";
  requestId: string;
}

export type WorkerRequest = GenerateRequest | CancelRequest;

export type WorkerResponse =
  | { version: typeof WORKER_PROTOCOL_VERSION; kind: "accepted"; requestId: string }
  | { version: typeof WORKER_PROTOCOL_VERSION; kind: "progress"; requestId: string; progress: GenerationProgress }
  | { version: typeof WORKER_PROTOCOL_VERSION; kind: "result"; requestId: string; payload: GenerationResultPayload }
  | { version: typeof WORKER_PROTOCOL_VERSION; kind: "cancelled"; requestId: string }
  | { version: typeof WORKER_PROTOCOL_VERSION; kind: "budgetExceeded"; requestId: string }
  | { version: typeof WORKER_PROTOCOL_VERSION; kind: "error"; requestId: string; message: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function validBudget(value: unknown): value is Partial<GenerationBudget> {
  if (!record(value)) return false;
  const allowed = new Set(["beamWidth", "maxExpansionsPerTopology", "maxCandidatesPerTopology", "maxTotalCandidates"]);
  return Object.entries(value).every(([key, item]) =>
    allowed.has(key) && Number.isSafeInteger(item) && (item as number) > 0,
  );
}

export function parseWorkerRequest(value: unknown): WorkerRequest | null {
  if (!record(value) || value.version !== WORKER_PROTOCOL_VERSION || !requestId(value.requestId)) return null;
  if (value.kind === "cancel") return { version: WORKER_PROTOCOL_VERSION, kind: "cancel", requestId: value.requestId };
  if (value.kind !== "generate" || !("project" in value) || typeof value.seed !== "string") return null;
  if (value.budget !== undefined && !validBudget(value.budget)) return null;
  if (value.cancellationBuffer !== undefined && !(value.cancellationBuffer instanceof SharedArrayBuffer)) return null;
  return {
    version: WORKER_PROTOCOL_VERSION,
    kind: "generate",
    requestId: value.requestId,
    project: value.project,
    seed: value.seed,
    ...(value.budget === undefined ? {} : { budget: value.budget }),
    ...(value.cancellationBuffer === undefined ? {} : { cancellationBuffer: value.cancellationBuffer }),
  };
}

function validProgress(value: unknown): value is GenerationProgress {
  return record(value) &&
    ["preflight", "search", "scoring", "selection"].includes(String(value.phase)) &&
    (value.topology === null || ["straight", "L", "T"].includes(String(value.topology))) &&
    Number.isSafeInteger(value.expandedStates) && (value.expandedStates as number) >= 0 &&
    Number.isSafeInteger(value.validCandidates) && (value.validCandidates as number) >= 0;
}

export function parseWorkerResponse(value: unknown): WorkerResponse | null {
  if (!record(value) || value.version !== WORKER_PROTOCOL_VERSION || !requestId(value.requestId)) return null;
  const base = { version: WORKER_PROTOCOL_VERSION, requestId: value.requestId } as const;
  if (value.kind === "accepted" || value.kind === "cancelled" || value.kind === "budgetExceeded") {
    return { ...base, kind: value.kind };
  }
  if (value.kind === "progress" && validProgress(value.progress)) return { ...base, kind: "progress", progress: value.progress };
  if (value.kind === "error" && typeof value.message === "string") return { ...base, kind: "error", message: value.message };
  if (value.kind === "result" && record(value.payload) && typeof value.payload.payloadVersion === "string") {
    return { ...base, kind: "result", payload: value.payload as unknown as GenerationResultPayload };
  }
  return null;
}

export function response<T extends Omit<WorkerResponse, "version">>(message: T): T & { version: typeof WORKER_PROTOCOL_VERSION } {
  return { version: WORKER_PROTOCOL_VERSION, ...message };
}
