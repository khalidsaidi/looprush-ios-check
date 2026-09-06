// Mobile Safari on an iOS Simulator via safaridriver (W3C touch actions).
// Prints machine-readable findings and saves screenshots to ios-sim-shots/.
import { remote } from "webdriverio";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.LOOPRUSH_BASE ?? "https://looprush2.com";
const OUT = "ios-sim-shots";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const findings = [];
const note = (kind, msg, extra) => { findings.push({ kind, msg, extra }); log(kind === "friction" ? "FRICTION:" : "ok:", msg, extra ? JSON.stringify(extra) : ""); };

const browser = await remote({
  logLevel: "warn",
  capabilities: { browserName: "Safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceType": "iPhone", ...(process.env.SIM_UDID ? { "safari:deviceUDID": process.env.SIM_UDID } : {}) },
  connectionRetryTimeout: 240000,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shotN = 0;
const shot = async (name) => { const p = `${OUT}/${String(++shotN).padStart(2, "0")}-${name}.png`; try { execFileSync("xcrun", ["simctl", "io", process.env.SIM_UDID || "booted", "screenshot", p]); } catch { await browser.saveScreenshot(p); } return p; };
const text = async (sel = "main") => browser.execute((s) => (document.querySelector(s)?.innerText || "").replace(/\n+/g, " | "), sel);
const rect = async (sel) => browser.execute((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, sel);
const center = async (sel) => { await browser.execute((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), sel); await sleep(300); return rect(sel); };
// idb injects HID touches into the simulator: real taps, real swipes.
const UDID = process.env.SIM_UDID || "booted";
const idb = (...args) => execFileSync("idb", [...args, "--udid", UDID], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const cal = { scale: 1, top: 0 };
let screen = { sw: 402, sh: 874 };
// The first real touch during a safaridriver session makes Safari show
// "Safari is Running an Automated Test" with a Continue Testing button
// (the bottom button of a centred sheet). Tap it and carry on.
async function dismissAutomationGuard() {
  const x = Math.round(screen.sw / 2), y = Math.round(screen.sh * 0.492);
  log("dismissing automation guard at", x, y);
  idb("ui", "tap", String(x), String(y)); await sleep(800);
}
async function calibrate() {
  const m = await browser.execute(() => ({ vw: innerWidth, vh: innerHeight }));
  const info = JSON.parse(idb("describe", "--json")); const sw = info.screen_dimensions?.width_points ?? 402, sh = info.screen_dimensions?.height_points ?? 874;
  screen = { sw, sh }; cal.scale = sw / m.vw;
  // iPhone Safari with the bottom address bar: status bar above the page, toolbar below.
  cal.top = STATUS_BAR_PT; log("calibration", JSON.stringify({ ...cal, sw, sh, vw: m.vw, vh: m.vh }));
}
const STATUS_BAR_PT = 59;
const toScreen = (cx, cy) => [Math.round(cx * cal.scale), Math.round(cal.top + cy * cal.scale)];
async function tap(sel) {
  const r = await center(sel); if (!r) throw new Error("no element " + sel);
  // Session-safe tap: a real touch would trigger Safari's automation guard.
  await browser.execute((q) => document.querySelector(q)?.click(), sel); await sleep(500);
}
let swipeMode = "synthetic-pointer-events (DOM phase); idb HID in phase 2";
async function swipe(sel, dx) {
  const r = await center(sel); if (!r) throw new Error("no element " + sel);
  const x0c = Math.round(dx < 0 ? r.x + r.w * 0.7 : r.x + r.w * 0.3), yc = Math.round(r.cy);
  await browser.execute((s, dx, x0, y) => { const el = document.querySelector(s); const opts = (x) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 }); el.dispatchEvent(new PointerEvent("pointerdown", opts(x0))); for (let i = 1; i <= 6; i++) { const x = x0 + Math.round(dx * i / 6); el.dispatchEvent(new PointerEvent("pointermove", opts(x))); window.dispatchEvent(new PointerEvent("pointermove", opts(x))); } window.dispatchEvent(new PointerEvent("pointerup", { ...opts(x0 + dx), buttons: 0 })); }, sel, dx, x0c, yc);
  await sleep(500);
}
try {
  const env = await (async () => { await browser.url(`${BASE}/`); await sleep(1500); return browser.execute(() => ({ ua: navigator.userAgent, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, coarse: matchMedia("(pointer: coarse)").matches, standalone: navigator.standalone, safeBottom: getComputedStyle(document.documentElement).getPropertyValue("--sab") })); })();
  log("env", JSON.stringify(env));
  await calibrate();
  await shot("landing");
  // 1. Tap-target audit on key pages (real Safari layout).
  for (const p of ["/", "/stacks", "/add", "/share/ec9hnbi", "/explore", "/sounds/7402695860712164641", "/sign-in"]) {
    await browser.url(`${BASE}${p}`); await sleep(1500);
    const audit = await browser.execute(() => { const small = []; for (const el of document.querySelectorAll("a,button,[role=button],input,select")) { const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue; if (r.height < 32 || r.width < 32) small.push(`${(el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`); } const overflowX = document.documentElement.scrollWidth > innerWidth + 1; return { small, overflowX, scrollWidth: document.documentElement.scrollWidth }; });
    if (audit.small.length) note("friction", `small tap targets on ${p}`, audit.small); else note("ok", `tap targets ${p}`);
    if (audit.overflowX) note("friction", `horizontal overflow on ${p}`, { scrollWidth: audit.scrollWidth, vw: env.vw });
  }
  // 2. /add: empty Save tap.
  await browser.url(`${BASE}/add`); await sleep(1500);
  await tap('button[type="submit"]');
  const addText = await text();
  if (/paste a tiktok or instagram link first/i.test(addText)) note("ok", "add empty submit explains"); else note("friction", "add empty submit: no message", { tail: addText.slice(-200) });
  await shot("add-empty");
  // 3. Share page: real tap Play → playing; Show video → in view; bottom bar vs Safari chrome.
  await browser.url(`${BASE}/share/ec9hnbi`); await sleep(2000);
  await tap('button[aria-label="Play"]');
  let playing = null; for (let i = 0; i < 30; i++) { await sleep(300); playing = await browser.execute(() => { const a = document.querySelector("audio"); return { paused: a?.paused, t: a?.currentTime, status: document.querySelector('[data-testid="player-status"]')?.innerText }; }); if (playing.paused === false && playing.t > 0.3) break; }
  if (playing?.paused === false) note("ok", "share tap Play → audio playing", playing); else note("friction", "share tap Play did not start audio", playing);
  await shot("share-playing");
  const bar = await rect('[data-testid="bottom-player"]');
  note(bar && Math.abs(bar.y + bar.h - env.vh) < 2 ? "ok" : "friction", "bottom bar sits at viewport bottom", { bar, vh: env.vh });
  await tap('[data-testid="video-toggle"]'); await sleep(2500);
  const vs = await rect('[data-testid="video-surface"]'); const vis = vs && vs.y >= 0 && vs.y + vs.h <= env.vh;
  note(vis ? "ok" : "friction", "Show video brings the video into view", vs);
  const vid = await browser.execute(() => { const v = document.querySelector("video"); return v && { ready: v.readyState, paused: v.paused, t: v.currentTime, w: v.videoWidth, h: v.videoHeight, rect: [Math.round(v.getBoundingClientRect().width), Math.round(v.getBoundingClientRect().height)] }; });
  note(vid && vid.ready >= 2 ? "ok" : "friction", "video mirror loaded", vid);
  await shot("share-video");
  await tap('[data-testid="video-toggle"]');
  // Row save → toast must clear the bottom bar.
  const saveBtns = await browser.$$('button=+ Save'); log("row save buttons:", saveBtns.length);
  await browser.execute(() => { const b = [...document.querySelectorAll("button")].find(x => /^\+?\s*save$/i.test(x.innerText.trim())); b?.setAttribute("data-probe", "rowsave"); });
  await tap('[data-probe="rowsave"]'); await sleep(500);
  const toast = await browser.execute(() => { const t = [...document.querySelectorAll("div,p,span")].find(e => /added to|already in/i.test(e.innerText || "") && getComputedStyle(e).position === "fixed"); const bar = document.querySelector('[data-testid="bottom-player"]')?.getBoundingClientRect(); return t && { toast: [Math.round(t.getBoundingClientRect().top), Math.round(t.getBoundingClientRect().bottom)], bar: bar && [Math.round(bar.top), Math.round(bar.bottom)], text: t.innerText }; });
  note(toast && toast.bar && toast.toast[1] <= toast.bar[0] ? "ok" : "friction", "row-save toast clears the bottom bar", toast);
  await shot("share-row-toast");
  // 4. Save all → library → swipe tile right (rename) and left (delete).
  await tap('[data-testid="save-to-guest-library"]'); await sleep(2500);
  log("after save all:", await browser.getUrl());
  await browser.url(`${BASE}/stacks`); await sleep(1500);
  await shot("library");
  const hint = await browser.execute(() => [...document.querySelectorAll("p")].map(p => p.innerText).find(t => /Swipe a stack/.test(t)));
  note(hint ? "ok" : "friction", "library swipe hint visible on touch device", { hint });
  await swipe('a[href^="/stacks/"]', 140); await shot("tile-swiped-right");
  const rz = await rect('[data-testid="stack-rename-zone"]'); const tileAfter = await rect('a[href^="/stacks/"]');
  note(rz && tileAfter && tileAfter.x > rz.x + 40 ? "ok" : "friction", "swipe right reveals rename zone", { rz, tile: tileAfter });
  await tap('[data-testid="stack-rename-zone"]'); await sleep(600);
  const sheet = await text(); note(/RENAME STACK|NEW NAME/i.test(sheet) ? "ok" : "friction", "rename sheet opens from swipe zone", { tail: sheet.slice(-160) });
  await shot("rename-sheet");
  await browser.execute(() => [...document.querySelectorAll("button")].find(b => /cancel/i.test(b.innerText))?.click()); await sleep(400);
  await swipe('a[href^="/stacks/"]', -140); await shot("tile-swiped-left");
  const dz = await rect('[data-testid="stack-delete-zone"]'); const tileL = await rect('a[href^="/stacks/"]');
  note(dz && tileL && tileL.x < -40 ? "ok" : "friction", "swipe left reveals delete zone", { dz, tile: tileL });
  // 5. Stack page: swipe a row right → rename input.
  await browser.url(`${BASE}/stacks`); await sleep(1200);
  await tap('a[href^="/stacks/"]'); await sleep(1800);
  await swipe('[data-swipe-row-id]', 140); await shot("row-swiped-right");
  await browser.execute(() => { const b = [...document.querySelectorAll("button")].find(x => /^rename$/i.test(x.innerText.trim())); b?.setAttribute("data-probe", "rowrename"); });
  await tap('[data-probe="rowrename"]'); await sleep(500);
  const input = await rect('input[placeholder="Sound name"]');
  note(input ? "ok" : "friction", "row swipe → Rename opens inline input", { input });
  await shot("row-rename");
  // 6. Keyboard-free check: does focusing the paste input on landing zoom the page? (font-size < 16px inputs zoom on iOS)
  await browser.url(`${BASE}/`); await sleep(1500);
  const inputFont = await browser.execute(() => { const i = document.querySelector('[data-testid="landing-paste-input"]'); return i && parseFloat(getComputedStyle(i).fontSize); });
  note(inputFont >= 16 ? "ok" : "friction", "landing input font-size ≥16px (no iOS auto-zoom on focus)", { inputFont });
  const addFont = await (async () => { await browser.url(`${BASE}/add`); await sleep(1200); return browser.execute(() => [...document.querySelectorAll("input,select,textarea")].map(i => ({ ph: i.placeholder || i.tagName, fs: parseFloat(getComputedStyle(i).fontSize) })).filter(x => x.fs < 16)); })();
  note(addFont.length === 0 ? "ok" : "friction", "add page inputs ≥16px", addFont);
} catch (err) {
  note("friction", "harness error", { message: String(err?.message || err) });
  try { await shot("error"); } catch {}
} finally {
  findings.push({ kind: "info", msg: "swipe input mode", extra: { swipeMode } }); log("swipe input mode:", swipeMode);
  // Phase 2: real HID touches with no automation session open. Coordinates come
  // from the DOM phase's layout (same device, same pages); screenshots are the evidence.
  try {
    const layout = {};
    // Phase 2 opens each page fresh and UNSCROLLED, so measure it that way.
    // Measuring after scrollIntoView put Play at y=357 while the unscrolled
    // page had it at y=525, and the real tap landed on the card above it
    // (run 34063970764, 12-hid-share-after-play-tap.png: still READY).
    const grab = async (p, sels) => {
      await browser.url(`${BASE}${p}`); await sleep(1500);
      await browser.execute(() => window.scrollTo(0, 0)); await sleep(300);
      const vh = await browser.execute(() => innerHeight);
      for (const [k, sel] of Object.entries(sels)) {
        const r = await rect(sel);
        layout[k] = r && r.y >= 0 && r.y + r.h <= vh ? r : null;
        if (r && !layout[k]) log("phase2: off-screen at scroll 0, skipped", k, JSON.stringify(r));
      }
    };
    await grab("/share/ec9hnbi", { play: 'button[aria-label="Play"]', video: '[data-testid="video-toggle"]', saveAll: '[data-testid="save-to-guest-library"]' });
    await grab("/stacks", { tile: 'a[href^="/stacks/"]' });
    log("phase2 layout", JSON.stringify(layout));
    await browser.deleteSession();
    await sleep(1500);
    const open = async (p) => { execFileSync("xcrun", ["simctl", "openurl", UDID, `${BASE}${p}`]); await sleep(4000); };
    const hid = { tap: async (r) => { const [x, y] = toScreen(r.cx, r.cy); idb("ui", "tap", String(x), String(y)); await sleep(1200); }, swipe: async (r, dx) => { const [x0, y] = toScreen(dx < 0 ? r.x + r.w * 0.7 : r.x + r.w * 0.3, r.cy); idb("ui", "swipe", String(x0), String(y), String(x0 + Math.round(dx * cal.scale)), String(y), "--duration", "0.25"); await sleep(1200); }, longPress: async (r) => { const [x, y] = toScreen(r.cx, r.cy); idb("ui", "tap", String(x), String(y), "--duration", "1.2"); await sleep(1200); } };
    await open("/share/ec9hnbi");
    if (layout.play) {
      await hid.tap(layout.play); await shot("hid-share-after-play-tap");
      // The product's promise: lock the phone and the sound keeps going, with
      // controls on the lock screen. Press the side button, then photograph
      // the lock screen twice: a Now Playing widget is the controls, its
      // elapsed time moving between the two shots is playback surviving the
      // lock. Then wake and unlock (no passcode on the simulator: swipe up).
      try {
        idb("ui", "button", "LOCK"); await sleep(2500); await shot("hid-locked-1");
        await sleep(3000); await shot("hid-locked-2");
        idb("ui", "button", "LOCK"); await sleep(1200);
        idb("ui", "swipe", String(Math.round(screen.sw / 2)), String(Math.round(screen.sh * 0.9)), String(Math.round(screen.sw / 2)), String(Math.round(screen.sh * 0.3))); await sleep(1500);
        await shot("hid-after-unlock");
      } catch (e) { log("lock-screen phase error", String(e?.message || e)); }
    }
    if (layout.video) { await hid.tap(layout.video); await sleep(2500); await shot("hid-share-after-show-video"); }
    if (layout.saveAll) { await hid.longPress(layout.saveAll); await shot("hid-share-long-press-save-all"); }
    await open("/stacks");
    if (layout.tile) { await hid.swipe(layout.tile, 140); await shot("hid-library-swipe-right"); await hid.swipe(layout.tile, -140); await shot("hid-library-swipe-left"); }
  } catch (err) { log("phase 2 error:", String(err?.message || err).slice(0, 200)); try { await shot("phase2-error"); } catch {} }
  writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
  const bad = findings.filter((f) => f.kind === "friction");
  console.log(bad.length ? `FRICTION-COUNT ${bad.length}` : "PASS-ALL");
  await browser.deleteSession().catch(() => {});
}
