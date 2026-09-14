import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { CANONICAL_NORMALIZED_PROJECT } from "../src/domain/fixtures.ts";
import { WORKER_PROTOCOL_VERSION } from "../src/worker/protocol.ts";

const runs = 3;
const durations = [];
let responsivenessTicks = 0;
for (let index = 0; index < runs; index += 1) {
  const worker = new Worker(new URL("./node-worker-runner.ts", import.meta.url));
  const started = performance.now();
  const timer = setInterval(() => { responsivenessTicks += 1; }, 5);
  const outcome = await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.on("message", (message) => {
      if (["result", "error", "budgetExceeded"].includes(message.kind)) resolve(message);
    });
    worker.postMessage({
      version: WORKER_PROTOCOL_VERSION, kind: "generate", requestId: `benchmark-${index}`,
      project: CANONICAL_NORMALIZED_PROJECT, seed: "milestone-4-reference",
      budget: { beamWidth: 8, maxExpansionsPerTopology: 250, maxCandidatesPerTopology: 4, maxTotalCandidates: 12 },
    });
  });
  clearInterval(timer);
  durations.push(performance.now() - started);
  await worker.terminate();
  if (outcome.kind !== "result") throw new Error(`worker outcome: ${outcome.kind}`);
}
const sorted = [...durations].sort((a, b) => a - b);
console.log(JSON.stringify({ runs, durationsMs: durations.map((value) => Number(value.toFixed(1))), medianMs: Number(sorted[1].toFixed(1)), responsivenessTicks }, null, 2));
