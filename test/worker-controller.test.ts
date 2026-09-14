import assert from "node:assert/strict";
import test from "node:test";
import { GenerationController, type WorkerPort } from "../src/worker/controller.ts";
import { WORKER_PROTOCOL_VERSION } from "../src/worker/protocol.ts";

class FakeWorker implements WorkerPort {
  messages: unknown[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: unknown): void { this.messages.push(message); }
  terminate(): void { this.terminated = true; }
  emit(message: unknown): void { this.onmessage?.({ data: message } as MessageEvent<unknown>); }
  crash(message = "simulated crash"): void { this.onerror?.({ message } as ErrorEvent); }
}

const progress = (requestId: string, expandedStates: number, validCandidates = 0) => ({
  version: WORKER_PROTOCOL_VERSION, kind: "progress", requestId,
  progress: { phase: "search", topology: "straight", expandedStates, validCandidates },
});

const payload = (complete = true) => ({
  payloadVersion: "planlab-generation-result-payload-1", ok: true, layouts: [], diagnostics: [], candidates: [], metadata: {},
  selection: { status: complete ? "complete" : "partial", threshold: .2, complete, partial: !complete, reason: null, selected: [], layouts: [], pairwiseDistances: [] },
});

test("controller clamps regressing progress counters and rejects stale responses", () => {
  const workers: FakeWorker[] = [];
  const controller = new GenerationController(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 10_000);
  const first = controller.start({}, "one");
  workers[0]!.emit(progress(first, 10, 2));
  workers[0]!.emit(progress(first, 4, 1));
  assert.equal(controller.state.progress?.expandedStates, 10);
  assert.equal(controller.state.progress?.validCandidates, 2);
  const second = controller.start({}, "two");
  workers[0]!.emit({ version: WORKER_PROTOCOL_VERSION, kind: "result", requestId: first, payload: payload() });
  assert.equal(controller.state.requestId, second);
  assert.equal(controller.state.status, "generating");
  controller.dispose();
});

test("cancel is prompt and preserves the last compatible result", () => {
  const worker = new FakeWorker();
  const controller = new GenerationController(() => worker, 10_000);
  const first = controller.start({}, "seed");
  worker.emit({ version: WORKER_PROTOCOL_VERSION, kind: "result", requestId: first, payload: payload() });
  const retained = controller.state.lastCompatibleResult;
  controller.start({}, "next");
  controller.cancel();
  assert.equal(controller.state.status, "idle");
  assert.equal(controller.state.lastCompatibleResult, retained);
  controller.dispose();
});

test("worker crash recovers the port, preserves result, and retry reuses seed", () => {
  const workers: FakeWorker[] = [];
  const controller = new GenerationController(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 10_000);
  const first = controller.start({ edit: 1 }, "stable-seed");
  workers[0]!.emit({ version: WORKER_PROTOCOL_VERSION, kind: "result", requestId: first, payload: payload(false) });
  const retained = controller.state.lastCompatibleResult;
  controller.start({ edit: 2 }, "stable-seed");
  workers[0]!.crash();
  assert.equal(controller.state.status, "workerError");
  assert.equal(controller.state.lastCompatibleResult, retained);
  assert.equal(workers.length, 2);
  const retryId = controller.retry();
  assert.ok(retryId);
  const sent = workers[1]!.messages.at(-1) as { seed: string; project: unknown };
  assert.equal(sent.seed, "stable-seed");
  assert.deepEqual(sent.project, { edit: 2 });
  controller.dispose();
});

test("watchdog produces budgetExceeded and replaces a wedged worker", async () => {
  const workers: FakeWorker[] = [];
  const controller = new GenerationController(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 10);
  controller.start({}, "slow");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(controller.state.status, "budgetExceeded");
  assert.equal(workers[0]!.terminated, true);
  assert.equal(workers.length, 2);
  controller.dispose();
});
