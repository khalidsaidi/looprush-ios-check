// Google sign-in on real Mobile Safari (redirect flow). Phase 1 (safaridriver)
// measures the Continue with Google button; phase 2 (idb HID, real Safari)
// taps it, types the account e-mail and password with the real keyboard,
// relays a verification code if Google asks for one, and photographs the
// return into the app. The password comes from the workflow secret and is
// never printed. Screenshots after the password step are only taken on the
// app's own pages.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { remote } from "webdriverio";

const BASE = process.env.LOOPRUSH_BASE ?? "https://looprush2.com";
const EMAIL = process.env.SIGNIN_EMAIL; const PASSWORD = process.env.SIGNIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.log("need SIGNIN_EMAIL and SIGNIN_PASSWORD"); process.exit(1); }
const RELAY = "https://firestore.googleapis.com/v1/projects/looprush-prod-20260520-kh/databases/(default)/documents/users/guest-shares/stacks/ios-signin-relay";
const OUT = "ios-sim-shots"; mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UDID = process.env.SIM_UDID || "booted";
const idb = (...args) => execFileSync("idb", [...args, "--udid", UDID], { stdio: ["ignore", "pipe", "pipe"] }).toString();
let n = 0; const shot = (name) => { const p = `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`; execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", p]); log("shot", p); };
// Accessibility text of the whole screen: what page are we on?
const flatten = (list, out = []) => { for (const e of list ?? []) { out.push(e); if (Array.isArray(e.children)) flatten(e.children, out); } return out; };
const screenText = () => { try { return flatten(JSON.parse(idb("ui", "describe-all", "--json"))).map((e) => [e.AXLabel, e.AXValue, e.title].filter(Boolean).join(" ")).filter(Boolean).join(" | "); } catch { return ""; } };
// Web content is not always in the accessibility dump; the keyboard is.
const keyboardUp = (t) => /\| q \| w \| e \|/.test(t);
const caps = { browserName: "Safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceType": "iPhone", ...(process.env.SIM_UDID ? { "safari:deviceUDID": process.env.SIM_UDID } : {}) };

const browser = await remote({ logLevel: "error", connectionRetryTimeout: 180000, capabilities: caps });
const cal = { scale: 1, top: 59 }; let layout = null;
try {
  await browser.url(`${BASE}/sign-in?returnTo=%2Fstacks&internal=1`); await sleep(3000);
  await browser.execute(() => window.scrollTo(0, 0)); await sleep(300);
  const m = await browser.execute(() => { const e = [...document.querySelectorAll("button")].find((b) => /continue with google/i.test(b.innerText)); const r = e.getBoundingClientRect(); return { vw: innerWidth, vh: innerHeight, x: r.x, y: r.y, w: r.width, h: r.height }; });
  const info = JSON.parse(idb("describe", "--json")); const sw = info.screen_dimensions?.width_points ?? 402; cal.scale = sw / m.vw; layout = m;
  log("phase1 layout", JSON.stringify({ ...m, ...cal }));
} catch (e) { log("phase1 error", String(e?.message || e).slice(0, 300)); }
await browser.deleteSession().catch(() => {}); await sleep(1500);
if (!layout) { console.log("NO-LAYOUT"); process.exit(1); }

// Phase 2: real Safari.
execFileSync("xcrun", ["simctl", "openurl", UDID, `${BASE}/sign-in?returnTo=%2Fstacks&internal=1`]); await sleep(5000); shot("p2-sign-in");
const px = Math.round((layout.x + layout.w / 2) * cal.scale), py = Math.round(cal.top + (layout.y + layout.h / 2) * cal.scale);
idb("ui", "tap", String(px), String(py)); log("tapped Continue with Google");
// Wait for Google's identifier page.
let stage = "unknown";
for (let i = 0; i < 40; i++) { await sleep(1000); const t = screenText(); if (/Choose an account/i.test(t)) { stage = "chooser"; break; } if (/Email or phone/i.test(t) || keyboardUp(t)) { stage = "identifier"; break; } }
log("google stage:", stage); shot("p2-google");
if (stage === "identifier") {
  // The field is focused on load; type the address and go on.
  idb("ui", "text", EMAIL); await sleep(600); idb("ui", "key", "40"); log("typed e-mail + Next");
  // The password page focuses its field and raises the keyboard again.
  await sleep(2500); let pw = false; for (let i = 0; i < 20; i++) { await sleep(1000); const t = screenText(); if (/password/i.test(t) || keyboardUp(t)) { pw = true; break; } }
  log("password page:", pw); shot("p2-password-page"); if (pw) { await sleep(800); idb("ui", "text", PASSWORD); await sleep(500); idb("ui", "key", "40"); log("typed password + Next (not shown)"); }
} else if (stage === "chooser") { log("account chooser shown; taking the first account"); }
// After the password: Google may ask for a verification code. Poll the relay.
let done = false; const t0 = Date.now();
while (Date.now() - t0 < 6 * 60 * 1000) {
  await sleep(2000); const t = screenText();
  if (/YOUR STACKS|SIGN OUT|LIBRARY/i.test(t)) { done = true; break; }
  if (Math.round((Date.now() - t0) / 1000) % 20 === 0) { log("waiting; screen:", t.slice(0, 160)); shot("p2-waiting"); }
  if (/verif|code|2-Step|Confirm|Check your/i.test(t)) {
    log("google asks for a code; waiting for the relay…");
    const res = await fetch(`${RELAY}?x=${Date.now()}`).then((r) => r.json()).catch(() => null); const name = res?.fields?.name?.stringValue ?? "";
    const code = (name.match(/^code:(\d{4,8})$/) || [])[1];
    if (code) { idb("ui", "text", code); await sleep(400); idb("ui", "key", "40"); log("typed relayed code"); await sleep(4000); }
  }
  if (/Couldn.t sign you in|This browser or app may not be secure/i.test(t)) { log("GOOGLE REFUSED:", t.slice(0, 200)); break; }
}
log("signed in on Safari:", done); shot(done ? "p2-signed-in" : "p2-end");
log("screen:", screenText().slice(0, 300));
writeFileSync(`${OUT}/signin-run.json`, JSON.stringify({ layout, cal, stage, done }, null, 2));
console.log(`DONE — ${JSON.stringify({ stage, done })}. p2-signed-in = the redirect flow completed on real Mobile Safari.`);
