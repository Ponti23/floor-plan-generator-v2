import type { GenerationBudget, GenerationProgress } from "../domain/generator.ts";
import type { GenerationResultPayload } from "../domain/resultPayload.ts";
import { parseWorkerResponse, WORKER_PROTOCOL_VERSION, type GenerateRequest } from "./protocol.ts";

export type GenerationStatus = "idle" | "generating" | "complete" | "partial" | "infeasible" | "budgetExceeded" | "workerError";

export interface GenerationState {
  status: GenerationStatus;
  requestId: string | null;
  progress: GenerationProgress | null;
  lastCompatibleResult: GenerationResultPayload | null;
  error: string | null;
  /** Epoch milliseconds when the in-flight run started; null when idle. */
  startedAt: number | null;
  /** Watchdog budget in milliseconds, exposed so the UI can show the deadline. */
  watchdogMs: number;
}

export interface WorkerPort {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => WorkerPort;

interface Attempt { project: unknown; seed: string; budget?: Partial<GenerationBudget> }

export class GenerationController {
  private readonly createWorker: WorkerFactory;
  private readonly watchdogMs: number;
  private worker: WorkerPort;
  private sequence = 0;
  private cancellation: Int32Array | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private lastAttempt: Attempt | null = null;
  private listeners = new Set<(state: Readonly<GenerationState>) => void>();
  private stateValue: GenerationState = {
    status: "idle", requestId: null, progress: null, lastCompatibleResult: null, error: null,
    startedAt: null, watchdogMs: 8_000,
  };

  constructor(createWorker: WorkerFactory, watchdogMs = 8_000) {
    this.createWorker = createWorker;
    this.watchdogMs = watchdogMs;
    this.stateValue = { ...this.stateValue, watchdogMs };
    this.worker = this.attach(createWorker());
  }

  get state(): Readonly<GenerationState> { return this.stateValue; }

  subscribe(listener: (state: Readonly<GenerationState>) => void): () => void {
    this.listeners.add(listener);
    listener(this.stateValue);
    return () => this.listeners.delete(listener);
  }

  start(project: unknown, seed: string, budget?: Partial<GenerationBudget>): string {
    if (this.stateValue.status === "generating") this.cancel();
    const requestId = `generation-${++this.sequence}`;
    this.lastAttempt = { project, seed, ...(budget === undefined ? {} : { budget }) };
    this.cancellation = typeof SharedArrayBuffer === "undefined" ? null : new Int32Array(new SharedArrayBuffer(4));
    this.update({ status: "generating", requestId, progress: null, error: null, startedAt: Date.now() });
    const request: GenerateRequest = {
      version: WORKER_PROTOCOL_VERSION, kind: "generate", requestId, project, seed,
      ...(budget === undefined ? {} : { budget }),
      ...(this.cancellation === null ? {} : { cancellationBuffer: this.cancellation.buffer as SharedArrayBuffer }),
    };
    this.worker.postMessage(request);
    this.watchdog = setTimeout(() => {
      if (this.stateValue.requestId !== requestId || this.stateValue.status !== "generating") return;
      if (this.cancellation) Atomics.store(this.cancellation, 0, 2);
      this.replaceWorker();
      this.finish({ status: "budgetExceeded", requestId: null, error: null });
    }, this.watchdogMs);
    return requestId;
  }

  cancel(): void {
    if (this.stateValue.status !== "generating") return;
    const requestId = this.stateValue.requestId!;
    if (this.cancellation) Atomics.store(this.cancellation, 0, 1);
    else this.replaceWorker();
    this.worker.postMessage({ version: WORKER_PROTOCOL_VERSION, kind: "cancel", requestId });
    this.finish({ status: "idle", requestId: null, progress: null, error: null, startedAt: null });
  }

  retry(): string | null {
    return this.lastAttempt ? this.start(this.lastAttempt.project, this.lastAttempt.seed, this.lastAttempt.budget) : null;
  }

  /**
   * Return to a clean idle state, dropping the last compatible result.
   *
   * Used when the workspace itself is reset (Milestone 6): keeping an earlier
   * brief's layouts on screen after a reset would present them as current.
   */
  reset(): void {
    if (this.stateValue.status === "generating") this.cancel();
    this.lastAttempt = null;
    this.finish({ status: "idle", requestId: null, progress: null, lastCompatibleResult: null, error: null });
  }

  dispose(): void {
    this.clearWatchdog();
    this.worker.terminate();
    this.listeners.clear();
  }

  private attach(worker: WorkerPort): WorkerPort {
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => {
      const message = event.message || "worker crashed";
      this.replaceWorker();
      this.finish({ status: "workerError", requestId: null, error: message });
    };
    return worker;
  }

  private replaceWorker(): void {
    this.worker.terminate();
    this.worker = this.attach(this.createWorker());
  }

  private receive(raw: unknown): void {
    const message = parseWorkerResponse(raw);
    if (!message || message.requestId !== this.stateValue.requestId || this.stateValue.status !== "generating") return;
    if (message.kind === "accepted") return;
    if (message.kind === "progress") {
      const prior = this.stateValue.progress;
      this.update({ progress: {
        ...message.progress,
        expandedStates: Math.max(prior?.expandedStates ?? 0, message.progress.expandedStates),
        validCandidates: Math.max(prior?.validCandidates ?? 0, message.progress.validCandidates),
      } });
      return;
    }
    if (message.kind === "result") {
      const status: GenerationStatus = !message.payload.ok ? "infeasible" : message.payload.selection.complete ? "complete" : "partial";
      this.finish({ status, requestId: null, lastCompatibleResult: message.payload, error: null });
    } else if (message.kind === "cancelled") {
    this.finish({ status: "idle", requestId: null, progress: null, error: null, startedAt: null });
    } else if (message.kind === "budgetExceeded") {
      this.finish({ status: "budgetExceeded", requestId: null, error: null });
    } else {
      this.replaceWorker();
      this.finish({ status: "workerError", requestId: null, error: message.message });
    }
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private finish(patch: Partial<GenerationState>): void {
    this.clearWatchdog();
    this.cancellation = null;
    // Every terminal path clears the elapsed clock, so the UI can never show a
    // stale "running for N seconds" readout after a run has ended.
    this.update({ startedAt: null, ...patch });
  }

  private update(patch: Partial<GenerationState>): void {
    this.stateValue = { ...this.stateValue, ...patch };
    for (const listener of this.listeners) listener(this.stateValue);
  }
}
