/**
 * Dependency-free headless-Chrome driver over the DevTools protocol.
 * Used by the integration gate to drive the real page instead of mocking it.
 */
import { execFile, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function findBrowser(explicit) {
  const candidates = [
    explicit,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try {
      execFile(candidate, ["--version"], () => {});
      return candidate;
    } catch {
      // keep looking
    }
  }
  throw new Error("no Chrome or Edge executable found");
}

async function debuggerUrl(port, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page?.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch {
      // not up yet
    }
    await delay(250);
  }
  throw new Error("Chrome DevTools endpoint never became available");
}

function connect(url, onEvent) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolveReady, rejectReady) => {
    socket.addEventListener("open", () => resolveReady());
    socket.addEventListener("error", () => rejectReady(new Error("browser websocket failed")));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (onEvent && message.method) {
      try {
        onEvent(message);
      } catch {
        // a diagnostic hook must never break the driver
      }
    }
    if (message.id && pending.has(message.id)) {
      const { resolveResult, rejectResult } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        rejectResult(new Error(message.error.message));
      } else {
        resolveResult(message.result);
      }
    }
  });
  const send = async (method, params = {}) => {
    await ready;
    const id = nextId++;
    const result = new Promise((resolveResult, rejectResult) => {
      pending.set(id, { resolveResult, rejectResult });
    });
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  };
  return { send, close: () => socket.close(), ready };
}

export async function launchBrowser({ url, chrome, width = 1400, height = 1000, port = 9333, onEvent }) {
  const executable = findBrowser(chrome);
  const profile = mkdtempSync(join(tmpdir(), "planlab-cdp-"));
  const process_ = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ], { stdio: "ignore" });

  const connection = connect(await debuggerUrl(port), onEvent);
  await connection.ready;
  const { send } = connection;
  await send("Page.enable");
  await send("Runtime.enable");
  if (onEvent) {
    await send("Network.enable");
    await send("Log.enable");
  }
  await send("Page.navigate", { url });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return result.result?.value;
  };

  const waitFor = async (expression, { timeoutMs = 30_000, label = expression } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const value = await evaluate(expression);
        if (value) {
          return value;
        }
      } catch {
        // page may still be loading
      }
      await delay(500);
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  const close = async () => {
    try {
      await send("Browser.close");
    } catch {
      /* ignore */
    }
    connection.close();
    process_.kill();
  };

  return { evaluate, waitFor, close, send };
}
