import { Builder, By, until } from "selenium-webdriver";

const BASE = process.env.LOOPRUSH_BASE ?? "https://looprush2.com";
const VIDEO = process.env.LOOPRUSH_VIDEO ?? "https://www.tiktok.com/@nikkurpexai/video/7680622883466399007";

const driver = await new Builder().forBrowser("safari").build();
try {
  // Controls. (1) play() with no gesture at all; (2) play() 4 s after a
  // click without any unlock. If (1) is allowed, this Safari does not
  // enforce the gesture policy and the PASS below proves nothing.
  // Mark this browser as internal before anything else, so the run does not
  // land in analytics as a visitor.
  await driver.get(`${BASE}/?internal=1`);
  await driver.get(`${BASE}/sign-in`);
  await driver.wait(until.elementLocated(By.css("main")), 20000);
  await driver.manage().setTimeouts({ script: 15000 });
  const noGesture = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
    setTimeout(() => done('no-settle-after-3s'), 3000);
    Promise.resolve(a.play()).then(() => done('played'), (e) => done('refused:' + e.name));
  `);
  console.log("control 1 (no gesture):", noGesture);
  await driver.executeScript(`
    window.__ctl = 'pending';
    const b = document.createElement('button'); b.id = 'ctl-go'; b.textContent = 'go';
    b.style.cssText = 'position:fixed;top:20px;left:20px;z-index:99999;font-size:40px;padding:20px';
    b.addEventListener('click', () => {
      setTimeout(() => {
        const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
        Promise.resolve(a.play()).then(() => { window.__ctl = 'played'; }, (e) => { window.__ctl = 'refused:' + e.name; });
        setTimeout(() => { if (window.__ctl === 'pending') window.__ctl = 'no-settle'; }, 3000);
      }, 4000);
    });
    document.body.appendChild(b);
  `);
  await driver.findElement(By.id("ctl-go")).click();
  let control = "pending";
  for (let i = 0; i < 30 && control === "pending"; i++) {
    await new Promise((r) => setTimeout(r, 500));
    control = await driver.executeScript("return window.__ctl");
  }
  console.log("control 2 (click, then play 4 s later, no unlock):", control);

  // Real flow: landing paste → extraction → playback.
  await driver.get(`${BASE}/`);
  const input = await driver.wait(until.elementLocated(By.css('[data-testid="landing-paste-input"]')), 20000);
  await input.sendKeys(VIDEO);
  await driver.findElement(By.css('[data-testid="landing-paste-submit"]')).click();
  const t0 = Date.now();
  let state = null;
  while (Date.now() - t0 < 60000) {
    state = await driver.executeScript(`
      const a = document.querySelector('audio');
      return { url: location.pathname, status: (document.querySelector('[data-testid="player-status"]')||{}).innerText || null, playing: !!(a && !a.paused && a.currentTime > 0.3), t: a ? a.currentTime : null };
    `);
    if (state.playing) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("landing flow result:", JSON.stringify(state), "after", Date.now() - t0, "ms");
  const ok = state && state.playing;

  // Sounds list → PLAY link: playback must start on arrival (client-side
  // navigation after the tap).
  await driver.get(`${BASE}/sounds`);
  await driver.wait(until.elementLocated(By.css('a[href^="/sounds/"]')), 20000);
  await driver.findElement(By.css('a[href^="/sounds/"]')).click();
  let listState = null;
  const t1 = Date.now();
  const timeline = [];
  while (Date.now() - t1 < 15000) {
    timeline.push(`${Date.now() - t1}ms:${(await driver.executeScript(`const a=document.querySelector('audio'); return (location.pathname.split('/').pop()||'').slice(0,6)+' '+((document.querySelector('[data-testid="player-status"]')||{}).innerText||'-')+' p='+(a?a.paused:'?')+' r='+(a?a.readyState:'?');`))}`);
    listState = await driver.executeScript(`const a=document.querySelector('audio'); return {url:location.pathname, status:(document.querySelector('[data-testid="player-status"]')||{}).innerText||null, playing:!!(a && !a.paused && a.currentTime > 0.3)};`);
    if (listState.playing) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("sounds list PLAY →", JSON.stringify(listState));
  console.log("  timeline:", timeline.filter((_, i) => i % 2 === 0).slice(0, 14).join(" | "));
  console.log("  page trace:", await driver.executeScript("return (window.__lrLog||[]).join(' | ')"));

  // Share page: play, show video, then jump to the end → next track.
  await driver.get(`${BASE}/share/ec9hnbi`);
  await driver.wait(until.elementLocated(By.css('button[aria-label="Play"]')), 20000);
  await driver.findElement(By.css('button[aria-label="Play"]')).click();
  await new Promise((r) => setTimeout(r, 2500));
  await driver.findElement(By.xpath("//button[contains(., 'SHOW VIDEO') or contains(., 'Show video')]")).click();
  await new Promise((r) => setTimeout(r, 2500));
  const video = await driver.executeScript(`const v=document.querySelector('video'); const a=document.querySelector('audio'); return {audioPlaying: !!(a && !a.paused), video: v ? {playing: !v.paused, t: v.currentTime, ready: v.readyState} : null};`);
  console.log("share page video →", JSON.stringify(video));
  const before = await driver.executeScript(`return (document.querySelector('[data-testid="now-playing-title"]')||{}).innerText`);
  await driver.executeScript(`const a=document.querySelector('audio'); a.currentTime = Math.max(0, a.duration - 1);`);
  let adv = null;
  const t2 = Date.now();
  while (Date.now() - t2 < 8000) {
    adv = await driver.executeScript(`const a=document.querySelector('audio'); return {now:(document.querySelector('[data-testid="now-playing-title"]')||{}).innerText, playing: !!(a && !a.paused && a.currentTime > 0.2 && a.currentTime < 5)};`);
    if (adv.now !== before && adv.playing) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("auto-advance →", JSON.stringify({ before, ...adv }));
  // Lock-screen metadata (Now Playing) in real WebKit.
  const ms = await driver.executeScript(`const m = navigator.mediaSession && navigator.mediaSession.metadata; return m ? { title: m.title, artist: m.artist, artwork: (m.artwork||[]).length } : null;`);
  console.log("mediaSession →", JSON.stringify(ms));
  const allOk = ok && listState?.playing && video?.video?.playing && adv?.now !== before && adv?.playing;
  console.log(allOk ? "PASS-ALL" : "FAIL-SOME");
  if (!allOk) process.exitCode = 1;
  console.log(ok ? "PASS: audio played after async extraction" : "FAIL: audio did not play");
  if (!ok) process.exitCode = 1;
} finally {
  await driver.quit();
}
