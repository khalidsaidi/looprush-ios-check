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
  await browser.execute((u) => { const el = document.querySelector('[data-testid="landing-paste-form"] input[name="url"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, u); el.dispatchEvent(new Event("input", { bubbles: true })); window.scrollTo(0, 0); }, URL_);
  await sleep(500);
  const m = await browser.execute(() => { const b = document.querySelector('[data-testid="landing-paste-submit"]'); const r = b.getBoundingClientRect(); return { vw: innerWidth, vh: innerHeight, x: r.x, y: r.y, w: r.width, h: r.height, value: document.querySelector('[data-testid="landing-paste-form"] input[name="url"]').value.slice(0, 50) }; });
  const info = JSON.parse(idb("describe", "--json")); const sw = info.screen_dimensions?.width_points ?? 402; cal.scale = sw / m.vw; layout = m;
  log("phase1", JSON.stringify({ ...m, ...cal }));
  shot("landing-filled");
} catch (e) { log("phase1 error", String(e?.message || e).slice(0, 300)); }
await browser.deleteSession().catch(() => {}); await sleep(1500);
if (!layout || !layout.value) { console.log("NO-LAYOUT"); process.exit(1); }
// The field keeps its value across deleteSession (same Safari tab). Real tap.
const px = Math.round((layout.x + layout.w / 2) * cal.scale), py = Math.round(cal.top + (layout.y + layout.h / 2) * cal.scale);
idb("ui", "tap", String(px), String(py)); const t0 = Date.now(); log(`HID tap PLAY IT at ${px},${py}`);
for (const at of [2000, 5000, 9000, 14000, 20000]) { await sleep(at - (Date.now() - t0)); shot(`after-tap-plus-${Math.round(at / 1000)}s`); }
writeFileSync(`${OUT}/landing-run.json`, JSON.stringify({ URL_, layout, cal }, null, 2));
console.log("DONE — read after-tap-plus-9s/14s: the stack page with PLAYING + elapsed time = audio started from the paste; READY = iOS wanted a second tap.");
