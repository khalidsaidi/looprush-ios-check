// Does a landing-page paste on real Mobile Safari end with the sound PLAYING
// (audio primed inside the tap) or parked at READY (a second tap needed)?
// Phase 1 (safaridriver): open the landing, put the link in the field the
// React way, measure the PLAY IT button at scroll 0. Phase 2 (idb, no
// automation session): a real HID tap on that button, then screenshots
// while the save happens and the player appears.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { remote } from "webdriverio";
const BASE = process.env.LOOPRUSH_BASE ?? "https://looprush2.com"; const URL_ = process.env.PASTE_URL || "https://www.tiktok.com/@gymshark/video/7535909643172973846";
const OUT = "ios-sim-shots"; mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UDID = process.env.SIM_UDID || "booted";
const idb = (...args) => execFileSync("idb", [...args, "--udid", UDID], { stdio: ["ignore", "pipe", "pipe"] }).toString();
let n = 0; const shot = (name) => { const p = `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`; execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", p]); log("shot", p); };
const browser = await remote({ logLevel: "error", connectionRetryTimeout: 180000, capabilities: { browserName: "Safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceType": "iPhone", ...(process.env.SIM_UDID ? { "safari:deviceUDID": process.env.SIM_UDID } : {}) } });
let layout = null, cal = { scale: 1, top: 59 };
try {
  await browser.url(`${BASE}/?internal=1`); await sleep(2500);
  await browser.execute(() => window.scrollTo(0, 0)); await sleep(300);
  const m = await browser.execute(() => { const r = (q) => { const e = document.querySelector(q); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }; return { vw: innerWidth, vh: innerHeight, input: r('[data-testid="landing-paste-form"] input[name="url"]'), button: r('[data-testid="landing-paste-submit"]') }; });
  const info = JSON.parse(idb("describe", "--json")); const sw = info.screen_dimensions?.width_points ?? 402; cal.scale = sw / m.vw; layout = m;
  log("phase1", JSON.stringify({ ...m, ...cal }));
} catch (e) { log("phase1 error", String(e?.message || e).slice(0, 300)); }
await browser.deleteSession().catch(() => {}); await sleep(1500);
if (!layout) { console.log("NO-LAYOUT"); process.exit(1); }
// Phase 2: no automation session. Ending it reloads the tab, so open the
// landing fresh, then type the link with the real keyboard and press Return.
execFileSync("xcrun", ["simctl", "openurl", UDID, `${BASE}/?internal=1`]); await sleep(4000);
const pt = (r) => [Math.round((r.x + r.w / 2) * cal.scale), Math.round(cal.top + (r.y + r.h / 2) * cal.scale)];
const [ix, iy] = pt(layout.input); idb("ui", "tap", String(ix), String(iy)); await sleep(1200); shot("input-focused");
idb("ui", "text", URL_); await sleep(800); shot("typed");
const t0 = Date.now(); idb("ui", "key", "40"); log("HID Return pressed (submit)");
for (const at of [2000, 5000, 9000, 14000, 20000]) { await sleep(Math.max(0, at - (Date.now() - t0))); shot(`after-submit-plus-${Math.round(at / 1000)}s`); }
writeFileSync(`${OUT}/landing-run.json`, JSON.stringify({ URL_, layout, cal }, null, 2));
console.log("DONE — read after-tap-plus-9s/14s: the stack page with PLAYING + elapsed time = audio started from the paste; READY = iOS wanted a second tap.");
