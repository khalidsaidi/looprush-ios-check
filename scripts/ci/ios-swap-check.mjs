// Does Mobile Safari keep playing a freshly saved sound while the extractor
// replaces audio/{id}.m4a underneath it (provisional copy → levelled bytes,
// ~10–20 s after the save)? Safari streams media with many range requests,
// so a changed object mid-stream is the risk. Phase 1 (safaridriver) saves
// URL_1 to learn the stack page layout; phase 2 (idb HID, no automation
// session) saves URL_2 fresh, taps Play at once and photographs the player
// across the swap. The screenshots' status + elapsed time are the evidence.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { remote } from "webdriverio";

const BASE = process.env.LOOPRUSH_BASE ?? "https://looprush2.com";
const URL_1 = process.env.FRESH_URL_1, URL_2 = process.env.FRESH_URL_2;
if (!URL_1 || !URL_2) { console.log("need FRESH_URL_1 and FRESH_URL_2"); process.exit(1); }
const OUT = "ios-sim-shots"; mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UDID = process.env.SIM_UDID || "booted";
const idb = (...args) => execFileSync("idb", [...args, "--udid", UDID], { stdio: ["ignore", "pipe", "pipe"] }).toString();
let shotN = 0;
const shot = (name) => { const p = `${OUT}/${String(++shotN).padStart(2, "0")}-${name}.png`; execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", p]); log("shot", p); return p; };
const addUrl = (u) => `${BASE}/add?internal=1&text=${encodeURIComponent(u)}`;

const browser = await remote({
  logLevel: "error", connectionRetryTimeout: 180000,
  capabilities: { browserName: "Safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceType": "iPhone", ...(process.env.SIM_UDID ? { "safari:deviceUDID": process.env.SIM_UDID } : {}) },
});
const cal = { scale: 1, top: 59 };
let layout = null;
try {
  await browser.url(addUrl(URL_1));
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) {
    const st = await browser.execute(() => ({ path: location.pathname, play: !!document.querySelector('[data-testid="play-toggle"]'), bar: (document.querySelector('[data-testid="add-save-bar"]')?.innerText || "").slice(0, 60) }));
    if (st.path.startsWith("/stacks/") && st.play) break;
    if (i % 20 === 0) log("phase1 waiting", JSON.stringify(st));
    await sleep(250);
  }
  log(`phase1: saved + on stack page after ${Date.now() - t0} ms`);
  await browser.execute(() => window.scrollTo(0, 0)); await sleep(400);
  const m = await browser.execute(() => { const e = document.querySelector('[data-testid="play-toggle"]'); const r = e.getBoundingClientRect(); return { vw: innerWidth, vh: innerHeight, x: r.x, y: r.y, w: r.width, h: r.height, src: (document.querySelector("audio")?.currentSrc || "").slice(0, 120) }; });
  const info = JSON.parse(idb("describe", "--json")); const sw = info.screen_dimensions?.width_points ?? 402;
  cal.scale = sw / m.vw; layout = m;
  log("phase1 layout", JSON.stringify({ ...m, ...cal, sw }));
  execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", `${OUT}/00-phase1-stack.png`]);
} catch (e) { log("phase1 error", String(e?.message || e).slice(0, 300)); }
await browser.deleteSession().catch(() => {});
await sleep(1500);
if (!layout) { console.log("NO-LAYOUT"); process.exit(1); }

// Phase 2: fresh sound, real touches, no automation session.
const tSave = Date.now();
execFileSync("xcrun", ["simctl", "openurl", UDID, addUrl(URL_2)]);
// Give the page time to extract (prod: 2–8 s) and land on the stack page.
await sleep(11000); shot("p2-after-save");
const px = Math.round((layout.x + layout.w / 2) * cal.scale), py = Math.round(cal.top + (layout.y + layout.h / 2) * cal.scale);
idb("ui", "tap", String(px), String(py)); const tPlay = Date.now();
log(`phase2: tapped Play at ${px},${py} — ${Date.now() - tSave} ms after opening the add URL`);
const marks = [3000, 10000, 20000, 32000, 45000, 58000];
let prev = 0;
for (const at of marks) { await sleep(at - prev); prev = at; shot(`p2-play-plus-${Math.round(at / 1000)}s`); }
// Lock the phone at the end and shoot the widget: still the product's promise.
try { idb("ui", "button", "LOCK"); await sleep(2500); shot("p2-locked"); idb("ui", "button", "LOCK"); } catch (e) { log("lock error", String(e?.message || e)); }
writeFileSync(`${OUT}/swap-run.json`, JSON.stringify({ URL_1, URL_2, layout, cal, tSave, tPlay }, null, 2));
console.log("DONE — read the p2-play-plus-*s screenshots: status PLAYING and the elapsed time advancing through +20s/+32s = survived the swap; PAUSED/COULDN'T LOAD or a frozen counter = the swap broke playback.");
