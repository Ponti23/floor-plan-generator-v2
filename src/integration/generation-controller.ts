/**
 * UI-facing generation state machine. Job state and connectivity are separate;
 * poll responses are applied monotonically, so an older response arriving last
 * can never roll the UI backwards.
 */
import { CONTRACT_VERSION, type GenerationRequestV1, type JobV1, type LayoutV1, type ProblemV1 } from "./contracts.ts";
import {
  GenerationClient,
  isTerminal,
  reconnectDelay,
  type PollOutcome,
} from "./generation-client.ts";
import type { ProjectClient } from "./project-client.ts";

export type Connectivity = "online" | "offline";

export interface GenerationControllerState {
  status: string;
  job: JobV1 | null;
  problem: ProblemV1 | null;
  connectivity: Connectivity;
  layouts: LayoutV1[];
  /** true when a completed result belongs to an older brief than the current draft */
  stale: boolean;
  elapsedMs: number;
}

export interface GenerationControllerOptions {
  client: ProjectClient;
  onChange?: (state: GenerationControllerState) => void;
  visibility?: () => boolean;
  now?: () => number;
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  pollVisibleMs?: number;
  pollHiddenMs?: number;
  generationClient?: GenerationClient;
}

const TERMINAL = ["COMPLETED", "INFEASIBLE", "FAILED", "CANCELLED"];

export class GenerationController {
  private readonly client: ProjectClient;
  private readonly generationClient: GenerationClient;
  private readonly onChange: (state: GenerationControllerState) => void;
  private readonly visibility: () => boolean;
  private readonly now: () => number;
  private readonly setTimer: (handler: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly pollVisibleMs: number;
  private readonly pollHiddenMs: number;
  private timer: unknown = null;
  private current: GenerationControllerState = {
    status: "idle",
    job: null,
    problem: null,
    connectivity: "online",
    layouts: [],
    stale: false,
    elapsedMs: 0,
  };
  private offlineAttempts = 0;
  private briefHash: string | null = null;
  private disposed = false;

  constructor(options: GenerationControllerOptions) {
    this.client = options.client;
    this.generationClient = options.generationClient ?? new GenerationClient({ client: options.client });
    this.onChange = options.onChange ?? (() => undefined);
    this.visibility = options.visibility ?? (() => true);
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.pollVisibleMs = options.pollVisibleMs ?? 1_000;
    this.pollHiddenMs = options.pollHiddenMs ?? 5_000;
  }

  get state(): GenerationControllerState {
    return { ...this.current, layouts: [...this.current.layouts] };
  }

  private emit(patch: Partial<GenerationControllerState>): void {
    this.current = { ...this.current, ...patch };
    this.onChange(this.state);
  }

  /** Start one job for a committed brief version and begin polling it. */
  async generate(
    projectId: string,
    briefVersionId: string,
    briefHash: string,
    idempotencyKey: string,
  ): Promise<string | null> {
    this.briefHash = briefHash;
    this.emit({
      status: "submitting",
      problem: null,
      connectivity: "online",
      stale: false,
      layouts: [],
      job: null,
    });
    try {
      const request: GenerationRequestV1 = {
        schemaVersion: CONTRACT_VERSION,
        projectId,
        briefVersionId,
        idempotencyKey,
      };
      const job = await this.generationClient.start(request);
      this.applyJob(job);
      this.schedule();
      return job.generationId;
    } catch (error) {
      const problem = (error as { problem?: ProblemV1 }).problem ?? null;
      this.emit({
        status: problem ? "failed" : "offline",
        problem,
        connectivity: problem ? "online" : "offline",
      });
      return null;
    }
  }

  /** One reconciliation fetch: used on focus, on reload and after reconnect. */
  async reconcile(generationId?: string): Promise<void> {
    const id = generationId ?? this.current.job?.generationId;
    if (!id) {
      return;
    }
    const outcome = await this.generationClient.poll(id);
    this.consume(outcome);
    if (this.current.job && !isTerminal(this.current.job.status)) {
      this.schedule();
    }
  }

  async cancel(): Promise<void> {
    const id = this.current.job?.generationId;
    if (!id) {
      return;
    }
    const outcome = await this.generationClient.cancel(id);
    this.consume(outcome);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.disposed) {
      return;
    }
    if (this.timer !== null) {
      this.clearTimer(this.timer);
    }
    const visible = this.visibility();
    const delay = this.current.connectivity === "offline"
      ? reconnectDelay(Math.max(0, this.offlineAttempts - 1))
      : (visible ? this.pollVisibleMs : this.pollHiddenMs);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    const id = this.current.job?.generationId;
    if (!id || isTerminal(this.current.status)) {
      return;
    }
    const outcome = await this.generationClient.poll(id);
    this.consume(outcome);
    if (!isTerminal(this.current.status)) {
      this.schedule();
    }
  }

  private consume(outcome: PollOutcome): void {
    if (outcome.offline) {
      this.offlineAttempts += 1;
      this.emit({ connectivity: "offline", elapsedMs: this.elapsed() });
      return;
    }
    this.offlineAttempts = 0;
    if (outcome.problem) {
      this.emit({ problem: outcome.problem, connectivity: "online" });
      return;
    }
    if (outcome.job) {
      this.applyJob(outcome.job);
    }
  }

  private applyJob(job: JobV1): void {
    const previous = this.current.job;
    if (previous && previous.generationId === job.generationId
      && job.stateVersion < previous.stateVersion) {
      return; // an older response arrived last: never roll the UI backwards
    }
    this.emit({
      status: job.status,
      job,
      connectivity: "online",
      problem: job.error ?? this.current.problem,
      elapsedMs: this.elapsed(job),
    });
    if (isTerminal(job.status)) {
      void this.loadLayouts(job);
    }
  }

  private async loadLayouts(job: JobV1): Promise<void> {
    if (job.status !== "COMPLETED" || job.layoutIds.length === 0) {
      return;
    }
    try {
      const layouts = await this.generationClient.layouts(job.generationId);
      const stale = this.current.job !== null
        && this.current.job.briefHash !== this.briefHash;
      this.emit({ layouts, stale });
    } catch {
      this.emit({ connectivity: "offline" });
    }
  }

  private elapsed(job: JobV1 | null = this.current.job): number {
    if (!job) {
      return 0;
    }
    if (job.elapsedMs && isTerminal(job.status)) {
      return job.elapsedMs;
    }
    const started = job.startedAt ?? job.createdAt;
    const startMs = Date.parse(started);
    if (Number.isNaN(startMs)) {
      return job.elapsedMs ?? 0;
    }
    return Math.max(0, this.now() - startMs);
  }
}

export { TERMINAL };
