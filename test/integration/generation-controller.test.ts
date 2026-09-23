/**
 * S07: polling, monotonic job state, reconnect, cancel and stale-result handling.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { JobV1, LayoutV1, ProblemV1 } from "../../src/integration/contracts.ts";
import { GenerationController } from "../../src/integration/generation-controller.ts";
import type { PollOutcome } from "../../src/integration/generation-client.ts";
import { EngineApiError } from "../../src/integration/project-client.ts";

const VERSIONS = {
  engineVersion: "geometry_engine_v1", engineSourceSha256: "a".repeat(64),
  modelVersion: "topology_v1" as const, checkpointId: "full_v1a/best" as const,
  checkpointSha256: "b".repeat(64), vocabularySha256: "c".repeat(64),
  serviceVersion: "0.1.0", contractVersion: "planlab.generation/1" as const,
  pythonVersion: "3.14.7", torchVersion: "2.9.0+cu129", ortoolsVersion: "9.15.6755",
};

function job(overrides: Partial<JobV1> = {}): JobV1 {
  return {
    schemaVersion: "planlab.generation/1",
    generationId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    briefVersionId: "33333333-3333-4333-8333-333333333333",
    briefHash: "f".repeat(64),
    status: "SOLVING",
    stateVersion: 3,
    progress: { stage: "SOLVING", candidateId: null, candidatesCompleted: null, candidatesTotal: 5 },
    createdAt: "2026-09-23T00:00:00Z",
    startedAt: "2026-09-23T00:00:01Z",
    finishedAt: null,
    elapsedMs: 0,
    cancelRequested: false,
    layoutIds: [],
    versions: null,
    error: null,
    warnings: [],
    ...overrides,
  };
}

const LAYOUT = {
  layoutId: "44444444-4444-4444-8444-444444444444",
  rank: 1,
  briefHash: "f".repeat(64),
} as unknown as LayoutV1;

const PROBLEM: ProblemV1 = {
  code: "NO_VALID_LAYOUT", category: "architectural",
  message: "No valid layout found for this brief within this engine's current search.",
  retryable: false, proof: "limited_search", fieldErrors: [], remediation: [],
  correlationId: "corr-1",
};

/** Fake transport with a scripted sequence and manual timers. */
class FakeClient {
  static generationRequest(projectId: string, briefVersionId: string, key: string) {
    return {
      schemaVersion: "planlab.generation/1" as const,
      projectId, briefVersionId, idempotencyKey: key,
    };
  }

  readonly created: unknown[] = [];
  readonly cancelled: string[] = [];
  polls: (() => Promise<PollOutcome>)[] = [];
  layoutsResult: LayoutV1[] = [];
  startError: unknown = null;

  async createGeneration(request: unknown): Promise<JobV1> {
    this.created.push(request);
    if (this.startError) {
      throw this.startError;
    }
    return job({ status: "QUEUED", stateVersion: 1 });
  }

  async getGeneration(): Promise<JobV1> {
    const next = this.polls.shift();
    if (!next) {
      return job();
    }
    const outcome = await next();
    if (!outcome.job) {
      throw new Error("no job");
    }
    return outcome.job;
  }

  async cancelGeneration(generationId: string): Promise<JobV1> {
    this.cancelled.push(generationId);
    return job({ status: "CANCELLED", stateVersion: 9, finishedAt: "2026-09-23T00:00:30Z" });
  }

  async getLayouts(): Promise<{ generationId: string; status: string; layouts: LayoutV1[] }> {
    return { generationId: "g", status: "COMPLETED", layouts: this.layoutsResult };
  }
}

function harness(options: { visible?: boolean } = {}) {
  const client = new FakeClient();
  const timers: { handler: () => void; ms: number }[] = [];
  const states: string[] = [];
  const controller = new GenerationController({
    client: client as never,
    visibility: () => options.visible ?? true,
    now: () => Date.parse("2026-09-23T00:00:21Z"),
    setTimer: (handler, ms) => {
      timers.push({ handler, ms });
      return timers.length - 1;
    },
    clearTimer: () => undefined,
    onChange: (state) => {
      states.push(`${state.status}:${state.connectivity}`);
    },
  });
  return { client, controller, timers, states };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test("generate posts once with an idempotency key and starts polling", async () => {
  const { client, controller, timers, states } = harness();
  const id = await controller.generate("p", "b", "hash-1", "key-1");
  assert.equal(id, "11111111-1111-4111-8111-111111111111");
  assert.equal(client.created.length, 1);
  assert.deepEqual(client.created[0], {
    schemaVersion: "planlab.generation/1", projectId: "p",
    briefVersionId: "b", idempotencyKey: "key-1",
  });
  assert.equal(states[0], "submitting:online");
  assert.equal(states[1], "QUEUED:online");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1_000, "visible tabs poll every second");
  controller.dispose();
});

test("hidden tabs poll more slowly and stop at a terminal status", async () => {
  const { client, controller, timers } = harness({ visible: false });
  await controller.generate("p", "b", "hash-1", "key-1");
  assert.equal(timers[0].ms, 5_000);
  client.polls.push(async () => ({ job: job({
    status: "COMPLETED", stateVersion: 7, finishedAt: "2026-09-23T00:00:30Z",
    layoutIds: ["44444444-4444-4444-8444-444444444444"], versions: VERSIONS,
  }), problem: null, offline: false }));
  client.layoutsResult = [LAYOUT];
  timers[0].handler();
  await flush();
  assert.equal(controller.state.status, "COMPLETED");
  assert.equal(controller.state.layouts.length, 1);
  assert.equal(controller.state.connectivity, "online");
  controller.dispose();
});

test("an older poll response arriving last never rolls the UI backwards", async () => {
  const { client, controller, timers } = harness();
  await controller.generate("p", "b", "hash-1", "key-1");
  client.polls.push(async () => ({ job: job({ status: "RANKING", stateVersion: 8 }),
    problem: null, offline: false }));
  timers[0].handler();
  await flush();
  assert.equal(controller.state.job?.stateVersion, 8);
  client.polls.push(async () => ({ job: job({ status: "SOLVING", stateVersion: 4 }),
    problem: null, offline: false }));
  timers[timers.length - 1].handler();
  await flush();
  assert.equal(controller.state.job?.stateVersion, 8, "state version must be monotonic");
  assert.equal(controller.state.status, "RANKING");
  controller.dispose();
});

test("connectivity is separate from job state and backs off while offline", async () => {
  const { client, controller, timers } = harness();
  await controller.generate("p", "b", "hash-1", "key-1");
  client.polls.push(async () => { throw new EngineApiError(503, null); });
  timers[0].handler();
  await flush();
  assert.equal(controller.state.connectivity, "offline");
  assert.equal(controller.state.status, "QUEUED", "the job state is preserved");
  assert.equal(timers[timers.length - 1].ms, 2_000, "first reconnect delay is 2 s");
  controller.dispose();
});

test("cancel calls the endpoint instead of aborting the fetch", async () => {
  const { client, controller } = harness();
  await controller.generate("p", "b", "hash-1", "key-1");
  await controller.cancel();
  assert.deepEqual(client.cancelled, ["11111111-1111-4111-8111-111111111111"]);
  assert.equal(controller.state.status, "CANCELLED");
  controller.dispose();
});

test("architectural infeasibility keeps its typed problem", async () => {
  const { client, controller, timers } = harness();
  await controller.generate("p", "b", "hash-1", "key-1");
  client.polls.push(async () => ({ job: job({
    status: "INFEASIBLE", stateVersion: 9, finishedAt: "2026-09-23T00:00:30Z",
    error: PROBLEM,
  }), problem: null, offline: false }));
  timers[0].handler();
  await flush();
  assert.equal(controller.state.status, "INFEASIBLE");
  assert.equal(controller.state.problem?.category, "architectural");
  assert.equal(controller.state.problem?.proof, "limited_search");
  assert.equal(controller.state.problem?.retryable, false);
  controller.dispose();
});

test("a result for an older brief is flagged stale, not shown as current", async () => {
  const { client, controller, timers } = harness();
  await controller.generate("p", "b", "hash-new", "key-1");
  client.polls.push(async () => ({ job: job({
    briefHash: "old".padEnd(64, "0"), status: "COMPLETED", stateVersion: 5,
    finishedAt: "2026-09-23T00:00:30Z",
    layoutIds: ["44444444-4444-4444-8444-444444444444"], versions: VERSIONS,
  }), problem: null, offline: false }));
  client.layoutsResult = [LAYOUT];
  timers[0].handler();
  await flush();
  assert.equal(controller.state.status, "COMPLETED");
  assert.equal(controller.state.stale, true);
  controller.dispose();
});

test("a non-retryable submit failure surfaces the server problem", async () => {
  const { client, controller } = harness();
  client.startError = new EngineApiError(409, PROBLEM);
  const id = await controller.generate("p", "b", "hash-1", "key-1");
  assert.equal(id, null);
  assert.equal(controller.state.status, "failed");
  assert.equal(controller.state.problem?.code, "NO_VALID_LAYOUT");
  controller.dispose();
});
