import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_NORMALIZED_PROJECT } from "../src/domain/fixtures.ts";
import { GenerationCancelledError, generateLayouts } from "../src/domain/generator.ts";
import { executeWorkerMessage } from "../src/worker/execute.ts";
import { parseWorkerRequest, parseWorkerResponse, WORKER_PROTOCOL_VERSION, type WorkerResponse } from "../src/worker/protocol.ts";

const baseRequest = {
  version: WORKER_PROTOCOL_VERSION,
  kind: "generate",
  requestId: "request-1",
  project: CANONICAL_NORMALIZED_PROJECT,
  seed: "worker-protocol",
} as const;

test("worker protocol accepts only its versioned, bounded message shapes", () => {
  assert.equal(parseWorkerRequest(baseRequest)?.kind, "generate");
  assert.equal(parseWorkerRequest({ ...baseRequest, version: "old" }), null);
  assert.equal(parseWorkerRequest({ ...baseRequest, requestId: "" }), null);
  assert.equal(parseWorkerRequest({ ...baseRequest, budget: { beamWidth: 0 } }), null);
  assert.equal(parseWorkerRequest({ ...baseRequest, budget: { surprise: 1 } }), null);
  assert.equal(parseWorkerResponse({ version: WORKER_PROTOCOL_VERSION, kind: "progress", requestId: "a", progress: { phase: "search", topology: "L", expandedStates: 3, validCandidates: 0 } })?.kind, "progress");
  assert.equal(parseWorkerResponse({ version: WORKER_PROTOCOL_VERSION, kind: "progress", requestId: "a", progress: { phase: "search", topology: "L", expandedStates: -1, validCandidates: 0 } }), null);
});

test("domain runtime reports monotonic counters without changing deterministic output", () => {
  const seen: number[] = [];
  const options = { seed: "runtime-observation", budget: { beamWidth: 4, maxExpansionsPerTopology: 80, maxCandidatesPerTopology: 2, maxTotalCandidates: 4 } };
  const observed = generateLayouts(CANONICAL_NORMALIZED_PROJECT, options, { onProgress: (progress) => seen.push(progress.expandedStates) });
  const plain = generateLayouts(CANONICAL_NORMALIZED_PROJECT, options);
  assert.deepEqual(observed, plain);
  assert.ok(seen.length > 2);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
});

test("domain runtime cooperatively cancels during bounded search", () => {
  let cancel = false;
  assert.throws(() => generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: "cooperative-cancel",
    budget: { maxExpansionsPerTopology: 1_000 },
  }, {
    shouldCancel: () => cancel,
    onProgress: (progress) => { if (progress.phase === "search") cancel = true; },
  }), GenerationCancelledError);
});

test("worker/domain integration transports the semantic projection and replays exactly", () => {
  const run = (): WorkerResponse[] => {
    const messages: WorkerResponse[] = [];
    executeWorkerMessage({ ...baseRequest, budget: { beamWidth: 4, maxExpansionsPerTopology: 80, maxCandidatesPerTopology: 2, maxTotalCandidates: 4 } }, (message) => messages.push(message));
    return messages;
  };
  const first = run();
  const second = run();
  const result = first.find((message) => message.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.deepEqual(first, second);
  const serialized = JSON.stringify(result.payload);
  assert.equal(serialized.includes("sharedWallIndex"), false);
  assert.equal(serialized.includes('"facts"'), false);
  assert.ok(first.some((message) => message.kind === "progress"));
});

test("worker maps a shared cooperative signal to cancellation", () => {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.store(signal, 0, 1);
  const messages: WorkerResponse[] = [];
  executeWorkerMessage({ ...baseRequest, cancellationBuffer: signal.buffer }, (message) => messages.push(message));
  assert.deepEqual(messages.map((message) => message.kind), ["accepted", "cancelled"]);
});
