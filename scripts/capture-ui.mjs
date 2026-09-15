/**
 * Screenshot QA harness for the PlanLab frontend fidelity loop.
 *
 * Milestone 5 requires the workspace to be compared against
 * `knowledge/PlanLab-Mockup.png` at 1536 x 1024.  This script drives the real
 * app in headless Chrome over the DevTools protocol: it starts nothing itself,
 * it points at an already-running Vite dev server, clicks Generate, waits for
 * the worker to finish, and writes a PNG plus a small digest of what the DOM
 * actually contains.
 *
 * Usage:
 *   node scripts/capture-ui.mjs --url http://127.0.0.1:5174
 *   node scripts/capture-ui.mjs --out artifacts/planlab/milestone-5/5.3.png --json artifacts/planlab/milestone-5/5.3.json
 *
 * Options:
 *   --url <url>       dev server URL (default http://127.0.0.1:5174)
 *   --out <path>      screenshot path (default artifacts/planlab/milestone-5/capture.png)
 *   --chrome <path>   Chrome or Edge executable (auto-detected by default)
 *   --width/--height  viewport in CSS pixels (default 1536 x 1024)
 *   --no-generate     capture the idle state without clicking Generate
 *   --pre <js>        run JavaScript after load and before clicking Generate
 *   --post <js>       run JavaScript after generation settles, before capture
 *   --immediate       capture while the run is still in flight instead of waiting
 *   --reload          reload the page (same profile, so storage persists) before capturing
 *   --post-reload <js> run JavaScript after the reload, before capturing
 *   --json <path>     also write the DOM digest as JSON
 */
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const REPO_ROOT = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const options = {
    url: "http://127.0.0.1:5174",
    out: resolve(REPO_ROOT, "artifacts", "planlab", "milestone-5", "capture.png"),
    width: 1536,
    height: 1024,
    generate: true,
    pre: null,
    post: null,
    immediate: false,
    reload: false,
    postReload: null,
    json: null,
    chrome: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--url") options.url = next;
    else if (arg === "--out") options.out = resolve(REPO_ROOT, next);
    else if (arg === "--width") options.width = Number(next);
    else if (arg === "--height") options.height = Number(next);
    else if (arg === "--chrome") options.chrome = next;
    else if (arg === "--json") options.json = resolve(REPO_ROOT, next);
    else if (arg === "--pre") options.pre = next;
    else if (arg === "--post") options.post = next;
    else if (arg === "--immediate") options.immediate = true;
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--post-reload") options.postReload = next;
    else if (arg === "--no-generate") options.generate = false;
  }
  return options;
}

function findChrome(explicit) {
  const candidates = [
    explicit,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try {
      execFile(candidate, ["--version"]);
      return candidate;
    } catch {
      // keep looking
    }
  }
  throw new Error("no Chrome or Edge executable found; pass --chrome <path>");
}

async function waitForDebugger(port, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // debugger not up yet
    }
    await delay(250);
  }
  throw new Error("Chrome DevTools endpoint never became available");
}

function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  const ready = new Promise((resolveReady, rejectReady) => {
    socket.addEventListener("open", () => resolveReady());
    socket.addEventListener("error", (event) => rejectReady(new Error(`websocket error: ${event.type}`)));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolveResult, rejectResult } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) rejectResult(new Error(message.error.message));
      else resolveResult(message.result);
      return;
    }
    const handlers = listeners.get(message.method);
    if (handlers) for (const handler of handlers) handler(message.params);
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
  const once = (method) => new Promise((resolveEvent) => {
    const handler = (params) => {
      listeners.set(method, (listeners.get(method) ?? []).filter((entry) => entry !== handler));
      resolveEvent(params);
    };
    listeners.set(method, [...(listeners.get(method) ?? []), handler]);
  });
  return { send, once, close: () => socket.close() };
}

const DOM_DIGEST = [
  "(() => {",
  "  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;",
  "  const all = (selector) => [...document.querySelectorAll(selector)].map((node) => node.textContent.trim());",
  "  const box = (selector) => {",
  "    const node = document.querySelector(selector);",
  "    if (!node) return null;",
  "    const rect = node.getBoundingClientRect();",
  "    return { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) };",
  "  };",
  "  return {",
  "    viewport: { width: window.innerWidth, height: window.innerHeight },",
  "    toolbarHeight: box('header.toolbar')?.height ?? null,",
  "    briefPane: box('.brief-pane'),",
  "    canvas: box('.canvas'),",
  "    analysisPane: box('.analysis'),",
  "    statusLabel: text('.brief-state'),",
  "    statusDetail: text('.brief-status'),",
  "    saveStatus: text('.save-indicator'),",
  "    projectName: document.querySelector('#project-name')?.value ?? null,",
  "    siteWidth: document.querySelector('#site-width')?.value ?? null,",
  "    siteDepth: document.querySelector('#site-depth')?.value ?? null,",
  "    variationSeed: document.querySelector('#generation-seed')?.value ?? null,",
  "    storageNotice: text('.storage-notice'),",
  "    optionCards: [...document.querySelectorAll('.option-card')].map((node) => ({",
  "      slot: node.querySelector('.option-badge')?.textContent?.trim() ?? null,",
  "      name: node.querySelector('.option-name')?.textContent?.trim() ?? null,",
  "      score: node.querySelector('strong')?.textContent?.trim() ?? null,",
  "      emptyReason: node.querySelector('.option-empty-reason')?.textContent?.trim() ?? null,",
  "      selected: node.classList.contains('selected'),",
  "      rooms: node.querySelectorAll('.thumbnail-space').length,",
  "    })),",
  "    summaryHeading: text('.analysis-heading h2'),",
  "    summaryScore: text('.analysis-heading strong'),",
  "    metricRows: all('.metric-row'),",
  "    scoreRows: all('.score-bar-row'),",
  "    ruleSummary: text('.rule-summary'),",
  "    ruleRows: all('.rule-row'),",
  "    observations: all('.observations .observation-item'),",
  "    notice: text('.conceptual-notice'),",
  "    svgPlan: document.querySelector('.canvas .plan-svg')?.getAttribute('viewBox') ?? null,",
  "  };",
  "})()",
].join("\n");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const chrome = findChrome(options.chrome);
  const port = 9000 + Math.floor(Math.random() * 900);
  const profile = mkdtempSync(resolve(tmpdir(), "planlab-capture-"));
  let postResult;
  let postReloadResult;
  /** Wall-clock timings measured by this harness, reported in the digest. */
  const timings = { generateMs: null };
  const child = spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${options.width},${options.height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const webSocketUrl = await waitForDebugger(port);
    const client = connect(webSocketUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: options.url });
    await loaded;
    await delay(400);

    if (options.pre) {
      const pre = await client.send("Runtime.evaluate", { expression: options.pre, returnByValue: true });
      if (pre.exceptionDetails) throw new Error(`--pre script failed: ${pre.exceptionDetails.text}`);
      await delay(200);
    }

    if (options.generate) {
      const generateStartedAt = Date.now();
      await client.send("Runtime.evaluate", {
        expression: "document.querySelector('#generate')?.click()",
        awaitPromise: false,
      });
      const attempts = options.immediate ? 2 : 100;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const probe = await client.send("Runtime.evaluate", {
          expression: "({ cards: document.querySelectorAll('.option-card').length, status: document.querySelector('.brief-status')?.textContent?.trim() ?? '' })",
          returnByValue: true,
        });
        const value = probe.result.value;
        if (value && value.cards > 0 && !/Generating|Preparing/i.test(value.status)) {
          timings.generateMs = Date.now() - generateStartedAt;
          break;
        }
        await delay(options.immediate ? 250 : 250);
      }
    }

    if (options.post) {
      const post = await client.send("Runtime.evaluate", { expression: options.post, returnByValue: true });
      if (post.exceptionDetails) throw new Error(`--post script failed: ${post.exceptionDetails.text}`);
      postResult = post.result.value;
      await delay(700);
    }

    if (options.reload) {
      const reloaded = client.once("Page.loadEventFired");
      await client.send("Page.reload", { ignoreCache: false });
      await reloaded;
      await delay(700);
    }

    if (options.postReload) {
      const after = await client.send("Runtime.evaluate", { expression: options.postReload, returnByValue: true });
      if (after.exceptionDetails) throw new Error(`--post-reload script failed: ${after.exceptionDetails.text}`);
      postReloadResult = after.result.value;
      await delay(400);
    }

    const digest = await client.send("Runtime.evaluate", {
      expression: DOM_DIGEST,
      returnByValue: true,
    });
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, Buffer.from(screenshot.data, "base64"));
    const value = digest.result.value;
    value.timings = timings;
    if (postResult !== undefined) value.postResult = postResult;
    if (postReloadResult !== undefined) value.postReloadResult = postReloadResult;
    if (options.json) {
      mkdirSync(dirname(options.json), { recursive: true });
      writeFileSync(options.json, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    process.stdout.write(`\nscreenshot: ${options.out}\n`);
    client.close();
  } finally {
    child.kill();
    // The DevTools socket and the browser's helper processes keep the event
    // loop alive after the capture is written, so exit explicitly.
    setTimeout(() => process.exit(0), 50).unref();
  }
}

await main();
