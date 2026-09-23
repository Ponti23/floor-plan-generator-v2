/**
 * Prove the exact-engine page works over a public URL: boot the editor against
 * the real model service, generate, and confirm options came back.
 *
 * Usage:
 *   node scripts/verify-public-engine.mjs --url https://example.trycloudflare.com
 *   node scripts/verify-public-engine.mjs --url https://floor-plan-generator-v2.vercel.app --out shot.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { launchBrowser } from "./lib/browser.mjs";

const argv = process.argv.slice(2);
function read(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const base = read("--url", "http://127.0.0.1:8010").replace(/\/+$/, "");
// A page hosted on a static host calls the model service somewhere else.
const apiBase = read("--api-base", base).replace(/\/+$/, "");
const out = resolve(read("--out", ".runtime/public/verify-engine.png"));
const generateTimeoutMs = Number(read("--timeout-ms", "480000"));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

let browser = null;
try {
  browser = await launchBrowser({ url: `${base}/engine.html`, width: 1400, height: 1000 });
  await browser.waitFor("Boolean(window.__planlabEngine)", {
    label: "engine page boot", timeoutMs: 60_000,
  });
  record("page boot", true, `${base}/engine.html mounted the exact engine editor`);

  const health = await browser.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(`${apiBase}/api/v1/health/ready`)});
    return { status: response.status, body: await response.text() };
  })()`);
  let versions = null;
  try {
    versions = JSON.parse(health.body)?.versions ?? null;
  } catch {
    versions = null;
  }
  record("service reachable from the page", health.status === 200,
    `${apiBase}/api/v1/health/ready returned HTTP ${health.status}`);
  record("trained model is loaded", versions?.checkpointId === "full_v1a/best",
    versions ? `checkpoint ${versions.checkpointId}, torch ${versions.torchVersion}, ortools ${versions.ortoolsVersion}`
      : "no versions payload");

  const rooms = await browser.evaluate("document.querySelectorAll('[data-room]').length");
  record("editor renders room instances", rooms >= 9, `${rooms} editable room instances`);

  await browser.evaluate("document.querySelector('#generate').click()");
  await browser.waitFor("window.__planlabEngine.state().layouts > 0", {
    timeoutMs: generateTimeoutMs, label: "a generated option",
  });
  const state = await browser.evaluate("window.__planlabEngine.state()");
  record("generation round trip", state.status === "COMPLETED" && state.layouts > 0,
    `${state.layouts} option(s) came back with status ${state.status}`);

  const plan = await browser.evaluate(`(() => {
    const svg = document.querySelector('[data-plan] svg');
    const analysis = document.querySelector('[data-analysis]');
    return {
      viewBox: svg?.getAttribute('viewBox') ?? null,
      rooms: svg ? svg.querySelectorAll('[data-room-id]').length : 0,
      openings: svg ? svg.querySelectorAll('[data-opening-id]').length : 0,
      scores: analysis ? analysis.querySelectorAll('[data-score]').length : 0,
      checks: analysis ? analysis.querySelectorAll('[data-check]').length : 0,
    };
  })()`);
  record("plan renders", Boolean(plan.viewBox) && plan.rooms > 0 && plan.openings > 0,
    `viewBox ${plan.viewBox}, ${plan.rooms} rooms, ${plan.openings} openings`);
  record("engine analysis renders", plan.scores === 6 && plan.checks >= 20,
    `${plan.scores} engine scores and ${plan.checks} independent checks`);

  const shot = await browser.send("Page.captureScreenshot", { format: "png" });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`screenshot: ${out}`);
} catch (error) {
  record("verification run", false, `${error?.message ?? error}`);
} finally {
  if (browser) await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed for ${base}`);
process.exit(failed.length === 0 ? 0 : 1);
