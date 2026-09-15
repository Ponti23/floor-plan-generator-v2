import assert from "node:assert/strict";
import test from "node:test";
import { GenerationController, type WorkerPort } from "../src/worker/controller.ts";
import { WORKER_PROTOCOL_VERSION } from "../src/worker/protocol.ts";
import { bumpVariationSeed } from "../src/app/editor-state.ts";
import { RECOMMENDED_PRESENTATION_COPY } from "../src/app/presentation-copy.ts";

/**
 * Milestone 5.4: the generation states the panel has to cover, the elapsed
 * clock the progress readout depends on, and the deterministic variation seed.
 */

class FakeWorker implements WorkerPort {
  messages: unknown[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: unknown): void { this.messages.push(message); }
  terminate(): void { this.terminated = true; }
  emit(message: unknown): void { this.onmessage?.({ data: message } as MessageEvent<unknown>); }
}

const payload = (ok: boolean, complete: boolean) => ({
  payloadVersion: "planlab-generation-result-payload-1",
  ok,
  layouts: [],
  diagnostics: [],
  candidates: [],
  metadata: {},
  selection: {
    status: ok ? (complete ? "complete" : "partial") : "infeasible",
    threshold: 0.2,
    complete,
    partial: !complete,
    reason: complete ? null : "INSUFFICIENT_DIVERSITY",
    selected: [],
    layouts: [],
    pairwiseDistances: [],
  },
});

const result = (requestId: string, ok: boolean, complete: boolean) => ({
  version: WORKER_PROTOCOL_VERSION,
  kind: "result",
  requestId,
  payload: payload(ok, complete),
});

test("the elapsed clock runs only while a generation is in flight", () => {
  const worker = new FakeWorker();
  const controller = new GenerationController(() => worker, 5_000);
  assert.equal(controller.state.startedAt, null);
  assert.equal(controller.state.watchdogMs, 5_000);

  const requestId = controller.start({}, "seed");
  const started = controller.state.startedAt;
  assert.equal(typeof started, "number");
  assert.ok(started !== null && started <= Date.now());

  worker.emit(result(requestId, true, true));
  assert.equal(controller.state.status, "complete");
  assert.equal(controller.state.startedAt, null, "a finished run stops the clock");
  controller.dispose();
});

test("cancel, worker failure and the watchdog all stop the clock", () => {
  const workers: FakeWorker[] = [];
  const controller = new GenerationController(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, 5_000);

  controller.start({}, "one");
  assert.notEqual(controller.state.startedAt, null);
  controller.cancel();
  assert.equal(controller.state.status, "idle");
  assert.equal(controller.state.startedAt, null);

  controller.start({}, "two");
  workers[0]!.onerror?.({ message: "crash" } as ErrorEvent);
  assert.equal(controller.state.status, "workerError");
  assert.equal(controller.state.startedAt, null);
  assert.equal(workers.length, 2, "a crashed port is replaced");
  controller.dispose();
});

test("partial and infeasible outcomes map to their own states", () => {
  const workers: FakeWorker[] = [];
  const controller = new GenerationController(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, 5_000);

  const partial = controller.start({}, "partial-seed");
  workers[0]!.emit(result(partial, true, false));
  assert.equal(controller.state.status, "partial");
  assert.equal(controller.state.lastCompatibleResult?.selection.partial, true);

  const infeasible = controller.start({}, "infeasible-seed");
  workers[0]!.emit(result(infeasible, false, false));
  assert.equal(controller.state.status, "infeasible");
  assert.equal(controller.state.startedAt, null);
  controller.dispose();
});

test("the watchdog reports the budget deadline the readout prints", async () => {
  const workers: FakeWorker[] = [];
  const controller = new GenerationController(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, 700);
  assert.equal(controller.state.watchdogMs, 700);
  controller.start({}, "slow");
  assert.equal(controller.state.watchdogMs, 700);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(controller.state.status, "generating", "still in flight before the deadline");
  controller.cancel();
  controller.dispose();
});

test("new variations move the seed deterministically instead of randomly", () => {
  assert.equal(bumpVariationSeed("canonical-0"), "canonical-1");
  assert.equal(bumpVariationSeed("canonical-1"), "canonical-2");
  assert.equal(bumpVariationSeed("seed"), "seed-2");
  assert.equal(bumpVariationSeed("seed-2"), "seed-3");
  assert.equal(bumpVariationSeed(""), "1");
  assert.equal(bumpVariationSeed("  spaced-9  "), "spaced-10");
  // The same starting seed always produces the same sequence.
  const sequence = [bumpVariationSeed("canonical-0"), bumpVariationSeed(bumpVariationSeed("canonical-0"))];
  assert.deepEqual(sequence, ["canonical-1", "canonical-2"]);
});

test("every generation state has approved copy to show", () => {
  const status = RECOMMENDED_PRESENTATION_COPY.status;
  for (const label of [
    status.readyLabel,
    status.invalidBriefLabel,
    status.generatingLabel,
    status.completeLabel,
    status.partialLabel,
    status.infeasibleLabel,
    status.budgetExceededLabel,
    status.workerErrorLabel,
    status.staleLabel,
  ]) {
    assert.ok(typeof label === "string" && label.length > 0);
  }
  for (const detail of [
    status.commitPrompt,
    status.invalidBrief,
    status.complete,
    status.partial,
    status.infeasible,
    status.budgetExceeded,
    status.workerError,
    status.staleResults,
    status.preparing,
  ]) {
    assert.ok(typeof detail === "string" && detail.length > 0);
  }
  assert.equal(RECOMMENDED_PRESENTATION_COPY.actions.newVariations, "New variations");
  assert.equal(RECOMMENDED_PRESENTATION_COPY.status.staleAction, "Regenerate");
  assert.match(RECOMMENDED_PRESENTATION_COPY.toolbar.disabledReason, /not available/i);
});
