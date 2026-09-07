// A guest shares a stack on real Mobile Safari. The tap publishes a snapshot
// (a network round trip) and only then copies the link / opens the share
// sheet; Safari drops the user gesture across that await, so the risk is a
// tap that publishes but shows "Couldn't copy". Phase 1 (safaridriver) saves
// URL_ to learn where the Share button sits; phase 2 (idb HID, no automation
// session) saves it fresh, taps SHARE STACK and photographs the result;
// phase 3 (safaridriver again) reads the guest library's share record,
// checks the public link and switches the share off again.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { remote } from "webdriverio";

const BASE = process.env.LOOPRUSH_BASE ?? "https://looprush2.com";
const URL_ = process.env.SHARE_URL || "https://www.tiktok.com/@gymshark/video/7535909643172973846";
const OUT = "ios-sim-shots"; mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UDID = process.env.SIM_UDID || "booted";
const idb = (...args) => execFileSync("idb", [...args, "--udid", UDID], { stdio: ["ignore", "pipe", "pipe"] }).toString();
let shotN = 0;
const shot = (name) => { const p = `${OUT}/${String(++shotN).padStart(2, "0")}-${name}.png`; execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", p]); log("shot", p); return p; };
const addUrl = (u) => `${BASE}/add?internal=1&text=${encodeURIComponent(u)}`;
const caps = { browserName: "Safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceType": "iPhone", ...(process.env.SIM_UDID ? { "safari:deviceUDID": process.env.SIM_UDID } : {}) };
const GUEST_KEY = "looprush.guest-library.v1";

async function waitForStack(browser) {
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) {
    const st = await browser.execute(() => ({ path: location.pathname, play: !!document.querySelector('[data-testid="play-toggle"]') }));
    if (st.path.startsWith("/stacks/") && st.play) return Date.now() - t0;
    if (i % 20 === 0) log("waiting", JSON.stringify(st));
    await sleep(250);
  }
  return -1;
}

let browser = await remote({ logLevel: "error", connectionRetryTimeout: 180000, capabilities: caps });
const cal = { scale: 1, top: 59 };
let layout = null;
try {
  await browser.url(addUrl(URL_));
  log(`phase1: on stack page after ${await waitForStack(browser)} ms`);
  await browser.execute(() => window.scrollTo(0, 0)); await sleep(400);
  const m = await browser.execute(() => {
    const e = document.querySelector('[data-testid="share-stack"]'); const r = e.getBoundingClientRect();
    return { vw: innerWidth, vh: innerHeight, x: r.x, y: r.y, w: r.width, h: r.height, label: e.innerText, canShare: typeof navigator.share === "function" };
  });
  const info = JSON.parse(idb("describe", "--json")); const sw = info.screen_dimensions?.width_points ?? 402;
  cal.scale = sw / m.vw; layout = m;
  log("phase1 layout", JSON.stringify({ ...m, ...cal, sw }));
  shot("phase1-stack");
} catch (e) { log("phase1 error", String(e?.message || e).slice(0, 300)); }
await browser.deleteSession().catch(() => {});
await sleep(1500);
if (!layout) { console.log("NO-LAYOUT"); process.exit(1); }

// Phase 2: real Safari, real thumb, no automation session.
execFileSync("xcrun", ["simctl", "openurl", UDID, addUrl(URL_)]);
await sleep(12000); shot("p2-stack-before-share");
const px = Math.round((layout.x + layout.w / 2) * cal.scale), py = Math.round(cal.top + (layout.y + layout.h / 2) * cal.scale);
// What the accessibility tree has under the finger, so a tap that does
// nothing can be told apart from a tap that landed somewhere else.
try { log("under finger:", idb("ui", "describe-point", String(px), String(py)).replace(/\s+/g, " ").slice(0, 300)); } catch (e) { log("describe-point failed", String(e?.message || e).slice(0, 120)); }
idb("ui", "tap", String(px), String(py)); const tTap = Date.now();
log(`phase2: tapped ${JSON.stringify(layout.label)} at ${px},${py}`);
let prev = 0;
for (const at of [1200, 3000, 6000, 10000]) { await sleep(at - prev); prev = at; shot(`p2-share-plus-${(at / 1000).toFixed(1)}s`); }
// A second tap tells a lost first tap (harness) apart from a broken button (product).
try { log("under finger (2nd):", idb("ui", "describe-point", String(px), String(py)).replace(/\s+/g, " ").slice(0, 300)); } catch { /* best effort */ }
idb("ui", "tap", String(px), String(py)); log("phase2: tapped again");
prev = 0; for (const at of [3000, 8000]) { await sleep(at - prev); prev = at; shot(`p2-second-tap-plus-${(at / 1000).toFixed(1)}s`); }
// A share sheet, if one opened, covers the page: drag it away and look again.
try { idb("ui", "swipe", "200", "500", "200", "850", "--duration", "0.3"); await sleep(1500); shot("p2-after-dismiss"); } catch (e) { log("dismiss error", String(e?.message || e)); }

// Phase 3: what did the tap actually do? Read the guest library share record.
let record = null;
// webdriverio's safaridriver launcher keeps the first instance in module
// state and refuses a second start; stop it through the same package.
try { const sd = await import("safaridriver"); await sd.stop(); } catch (e) { log("safaridriver stop", String(e?.message || e).slice(0, 120)); }
try { execFileSync("pkill", ["-x", "safaridriver"]); } catch { /* none running */ }
await sleep(1500);
browser = await remote({ logLevel: "error", connectionRetryTimeout: 180000, capabilities: caps });
try {
  await browser.url(`${BASE}/stacks/saved?internal=1`); await sleep(2500);
  record = await browser.execute((key) => {
    let lib = null; try { lib = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    const shares = lib?.shares ?? null;
    const btn = document.querySelector('[data-testid="share-stack"]');
    return { shares, tracks: lib?.stacks?.saved?.items?.length ?? lib?.items?.length ?? null, label: btn?.innerText ?? null, sameStorage: Boolean(lib) };
  }, GUEST_KEY);
  log("phase3 record", JSON.stringify(record));
  shot("phase3-stack");
} catch (e) { log("phase3 error", String(e?.message || e).slice(0, 300)); }
await browser.deleteSession().catch(() => {});

let link = null;
const share = record?.shares && Object.values(record.shares)[0];
if (share?.publicId) {
  const res = await fetch(`${BASE}/share/${share.publicId}`, { redirect: "manual" });
  link = { publicId: share.publicId, status: res.status };
  log("share page", JSON.stringify(link));
  // Clean up: switch the share off again so the run leaves nothing public.
  const del = await fetch(`${BASE}/api/share/guest`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicId: share.publicId, secret: share.secret }) });
  log("unshare", del.status);
}
writeFileSync(`${OUT}/share-run.json`, JSON.stringify({ URL_, layout, cal, tTap, record, link }, null, 2));
console.log(`DONE — ${JSON.stringify({ label: layout.label, record, link })}. Read p2-share-plus-*: "Link copied" toast or a share sheet = the tap worked; "Couldn't copy" / "Couldn't share" = the gesture was lost across the publish.`);
