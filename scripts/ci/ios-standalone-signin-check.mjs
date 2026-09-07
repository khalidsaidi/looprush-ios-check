// Google sign-in from the Home Screen app on iOS: add looprush2.com to the
// Home Screen through Safari's share sheet, open the standalone app, tap
// Sign in → Continue with Google, type the account with the real keyboard,
// and photograph the return. All taps go through the accessibility tree
// (labels), so Safari's toolbar layout does not matter.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

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
const flatten = (list, out = []) => { for (const e of list ?? []) { out.push(e); if (Array.isArray(e.children)) flatten(e.children, out); } return out; };
const elements = () => { try { return flatten(JSON.parse(idb("ui", "describe-all", "--json"))); } catch { return []; } };
const keyboardUp = (t) => /\| q \| w \| e \|/.test(t);
const screenText = () => elements().map((e) => e.AXLabel || e.AXValue || "").filter(Boolean).join(" | ");
const find = (re) => elements().find((e) => e.frame && [e.AXLabel, e.AXValue, e.title].filter(Boolean).some((v) => re.test(String(v).trim())));
const tapEl = (e) => { const f = e.frame; idb("ui", "tap", String(Math.round(f.x + f.width / 2)), String(Math.round(f.y + f.height / 2))); };
const tapLabel = async (re, what, tries = 10) => { for (let i = 0; i < tries; i++) { const e = find(re); if (e) { tapEl(e); log(`tapped ${what} at ${Math.round(e.frame.x)},${Math.round(e.frame.y)}`); return true; } await sleep(1000); } log(`NOT FOUND: ${what}; screen: ${screenText().slice(0, 240)}`); return false; };

// 1. Add to Home Screen from Safari.
execFileSync("xcrun", ["simctl", "openurl", UDID, `${BASE}/?internal=1`]); await sleep(6000); shot("safari-landing");
if (!(await tapLabel(/^(More|Page Menu|Share)$/i, "Safari menu/share"))) process.exit(1);
await sleep(1500); shot("safari-menu");
// Safari's feature tip ("Highlights") can cover the menu; dismiss it and reopen.
if (find(/dismiss popup/i)) { await tapLabel(/dismiss popup/i, "dismiss tip"); await sleep(1200); await tapLabel(/^(More|Page Menu|Share)$/i, "Safari menu again"); await sleep(1500); shot("safari-menu-2"); }
if (find(/^Share…?$/i)) { await tapLabel(/^Share…?$/i, "Share"); await sleep(2000); }
shot("share-sheet");
let added = await tapLabel(/Add to Home Screen/i, "Add to Home Screen", 5);
if (!added) { idb("ui", "swipe", "200", "700", "200", "300", "--duration", "0.4"); await sleep(1500); added = await tapLabel(/Add to Home Screen/i, "Add to Home Screen (after scroll)", 5); }
if (!added) process.exit(1);
await sleep(2000); shot("add-dialog"); await tapLabel(/^Add$/i, "Add"); await sleep(3000);
// 2. Open the app from the Home Screen.
idb("ui", "button", "HOME"); await sleep(2500); shot("home");
if (!(await tapLabel(/LoopRush/i, "LoopRush icon"))) process.exit(1);
await sleep(7000); shot("app-open");
log("app screen:", screenText().slice(0, 240));
// 3. Sign in from the library header.
await tapLabel(/^Sign in$/i, "Sign in link", 8); await sleep(4000); shot("app-sign-in");
if (!(await tapLabel(/Continue with Google/i, "Continue with Google"))) process.exit(1);
let stage = "unknown";
for (let i = 0; i < 40; i++) { await sleep(1000); const t = screenText(); if (/Choose an account/i.test(t)) { stage = "chooser"; break; } if (/Email or phone/i.test(t) || keyboardUp(t)) { stage = "identifier"; break; } }
log("google stage:", stage); shot("google");
if (stage === "identifier") {
  idb("ui", "text", EMAIL); await sleep(600); idb("ui", "key", "40"); log("typed e-mail + Next");
  // Google's password page does not focus its field on iOS; tap where the
  // field sits (same layout on every iPhone width), which raises the keyboard.
  await sleep(6000); const info = JSON.parse(idb("describe", "--json")); const sw = info.screen_dimensions?.width_points ?? 402, sh = info.screen_dimensions?.height_points ?? 874;
  idb("ui", "tap", String(Math.round(sw * 0.5)), String(Math.round(sh * 0.477))); await sleep(1200);
  let pw = false; for (let i = 0; i < 15; i++) { await sleep(1000); const t = screenText(); if (keyboardUp(t)) { pw = true; break; } idb("ui", "tap", String(Math.round(sw * 0.5)), String(Math.round(sh * 0.477))); }
  log("password page:", pw); shot("password-page"); if (pw) { await sleep(800); idb("ui", "text", PASSWORD); await sleep(500); idb("ui", "key", "40"); log("typed password + Next (not shown)"); }
}
let done = false; const t0 = Date.now();
while (Date.now() - t0 < 6 * 60 * 1000) {
  await sleep(2000); const t = screenText();
  if (/YOUR STACKS|SIGN OUT|Your library/i.test(t)) { done = true; break; }
  if (Math.round((Date.now() - t0) / 1000) % 20 === 0) { log("waiting; screen:", t.slice(0, 160)); shot("waiting"); }
  if (/verif|code|2-Step|Confirm|Check your/i.test(t)) { const res = await fetch(`${RELAY}?x=${Date.now()}`).then((r) => r.json()).catch(() => null); const code = ((res?.fields?.name?.stringValue ?? "").match(/^code:(\d{4,8})$/) || [])[1]; if (code) { idb("ui", "text", code); await sleep(400); idb("ui", "key", "40"); log("typed relayed code"); await sleep(4000); } }
  if (/Couldn.t sign you in|not secure/i.test(t)) { log("GOOGLE REFUSED:", t.slice(0, 200)); break; }
}
log("signed in inside the Home Screen app:", done); shot(done ? "app-signed-in" : "app-end");
log("screen:", screenText().slice(0, 300));
writeFileSync(`${OUT}/standalone-run.json`, JSON.stringify({ stage, done }, null, 2));
console.log(`DONE — ${JSON.stringify({ stage, done })}`);
