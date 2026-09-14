import { GenerationCancelledError, generateLayouts } from "../domain/generator.ts";
import { projectGenerationResult } from "../domain/resultPayload.ts";
import { parseWorkerRequest, response, type GenerateRequest, type WorkerResponse } from "./protocol.ts";

export type WorkerEmitter = (message: WorkerResponse) => void;

function cancellationCode(request: GenerateRequest): number {
  return request.cancellationBuffer ? Atomics.load(new Int32Array(request.cancellationBuffer), 0) : 0;
}

export function executeWorkerMessage(raw: unknown, emit: WorkerEmitter): void {
  const request = parseWorkerRequest(raw);
  if (!request) return;
  if (request.kind === "cancel") return;
  emit(response({ kind: "accepted", requestId: request.requestId }));
  try {
    const result = generateLayouts(request.project as never, {
      seed: request.seed,
      ...(request.budget === undefined ? {} : { budget: request.budget }),
    }, {
      shouldCancel: () => cancellationCode(request) !== 0,
      onProgress: (progress) => emit(response({ kind: "progress", requestId: request.requestId, progress })),
    });
    const code = cancellationCode(request);
    if (code === 2) emit(response({ kind: "budgetExceeded", requestId: request.requestId }));
    else if (code === 1) emit(response({ kind: "cancelled", requestId: request.requestId }));
    else emit(response({ kind: "result", requestId: request.requestId, payload: projectGenerationResult(result) }));
  } catch (error) {
    const code = cancellationCode(request);
    if (error instanceof GenerationCancelledError || code !== 0) {
      emit(response({ kind: code === 2 ? "budgetExceeded" : "cancelled", requestId: request.requestId }));
      return;
    }
    emit(response({
      kind: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "unknown worker error",
    }));
  }
}
