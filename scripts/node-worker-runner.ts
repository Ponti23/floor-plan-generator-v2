import { parentPort } from "node:worker_threads";
import { executeWorkerMessage } from "../src/worker/execute.ts";

parentPort?.on("message", (message) => executeWorkerMessage(message, (response) => parentPort?.postMessage(response)));
