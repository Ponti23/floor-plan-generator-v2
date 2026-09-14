/// <reference lib="webworker" />
import { executeWorkerMessage } from "./execute.ts";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  executeWorkerMessage(event.data, (message) => self.postMessage(message));
});
