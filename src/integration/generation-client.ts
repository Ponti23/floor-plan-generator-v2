/**
 * Generation transport: one idempotent POST, then polling that survives reloads,
 * hidden tabs and connectivity loss. Aborting a fetch never cancels compute —
 * only the explicit cancel endpoint does that.
 */
import { EngineApiError, type ProjectClient } from "./project-client.ts";
import type { GenerationRequestV1, JobV1, LayoutV1, ProblemV1 } from "./contracts.ts";

export const TERMINAL_STATUSES = ["COMPLETED", "INFEASIBLE", "FAILED", "CANCELLED"] as const;

export interface Sleep {
  (milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface GenerationClientOptions {
  client: ProjectClient;
  sleep?: Sleep;
}

export interface PollOutcome {
  job: JobV1 | null;
  problem: ProblemV1 | null;
  offline: boolean;
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** 2 s, 5 s, 10 s, then 10 s: the plan's reconnect ladder. */
export function reconnectDelay(attempt: number): number {
  const ladder = [2_000, 5_000, 10_000];
  return ladder[Math.min(attempt, ladder.length - 1)];
}

export class GenerationClient {
  private readonly client: ProjectClient;
  private readonly sleep: Sleep;

  constructor(options: GenerationClientOptions) {
    this.client = options.client;
    this.sleep = options.sleep
      ?? ((ms, signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }));
  }

  /**
   * Submit once. A response lost in transit is retried with the SAME key, so the
   * server returns the existing job instead of starting a second one.
   */
  async start(request: GenerationRequestV1, attempts = 3): Promise<JobV1> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.client.createGeneration(request);
      } catch (error) {
        lastError = error;
        if (error instanceof EngineApiError && !error.retryable) {
          throw error;
        }
        if (attempt < attempts - 1) {
          await this.sleep(reconnectDelay(attempt));
        }
      }
    }
    throw lastError;
  }

  async poll(generationId: string, signal?: AbortSignal): Promise<PollOutcome> {
    try {
      const job = await this.client.getGeneration(generationId, signal);
      return { job, problem: null, offline: false };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof EngineApiError) {
        if (error.status === 404) {
          return { job: null, problem: error.problem, offline: false };
        }
        if (error.status >= 500 || error.status === 429 || error.problem === null) {
          return { job: null, problem: null, offline: true };
        }
        return { job: null, problem: error.problem, offline: false };
      }
      return { job: null, problem: null, offline: true };
    }
  }

  async cancel(generationId: string): Promise<PollOutcome> {
    try {
      const job = await this.client.cancelGeneration(generationId);
      return { job, problem: null, offline: false };
    } catch (error) {
      if (error instanceof EngineApiError) {
        if (error.status >= 500) {
          return { job: null, problem: null, offline: true };
        }
        return { job: null, problem: error.problem, offline: false };
      }
      return { job: null, problem: null, offline: true };
    }
  }

  async layouts(generationId: string): Promise<LayoutV1[]> {
    const payload = await this.client.getLayouts(generationId);
    return payload.layouts ?? [];
  }
}
