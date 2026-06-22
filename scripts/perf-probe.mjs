#!/usr/bin/env node
/**
 * perf-probe.mjs — technology-agnostic render-cost probe.
 *
 * Opens a URL in a REAL browser (Playwright Chromium) forced onto SOFTWARE
 * rendering (CPU compositing) — the worst case a user with hardware
 * acceleration disabled, or a weak GPU, will hit. Measures how smooth the page
 * is by sampling per-frame timing, so you can stop guessing about CSS cost and
 * MEASURE it. Trust RELATIVE comparisons (baseline vs your fix) over absolute
 * numbers; the amplified DPR + software GL is a deliberate worst case.
 *
 * Prereq (once): `npm i -D playwright && npx playwright install chromium`.
 *
 * Usage:
 *   node perf-probe.mjs https://localhost:3000/
 *   node perf-probe.mjs http://localhost:3000/page --screenshot out.png
 *   node perf-probe.mjs URL --ms=6000 --scroll          # measure WHILE scrolling
 *   node perf-probe.mjs URL --width=1440 --height=900 --dpr=1
 *
 * Output: ~fps, count of long (janky) frames, worst frame, p95 frame time.
 *   ~60fps + few long frames  => smooth.
 *   low fps / many long frames => heavy per-frame work (paint/composite).
 * Diagnose a culprit: re-run with one CSS override injected at a time
 * (animation off, blur off, blend off, smaller) and compare — see SKILL.md.
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error("usage: node perf-probe.mjs <url> [--screenshot=path] [--ms=4000] [--scroll] [--width=1920] [--height=1080] [--dpr=2]");
  process.exit(1);
}
const flag = (name, def) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
};
const MS = Number(flag("ms", 4000));
const WIDTH = Number(flag("width", 1920));
const HEIGHT = Number(flag("height", 1080));
const DPR = Number(flag("dpr", 2));
const SCROLL = !!flag("scroll", false);
const SHOT = flag("screenshot", null);
const LONG_FRAME_MS = 24; // a 60fps frame budget is ~16.7ms; >24ms = a dropped frame

const browser = await chromium.launch({
  headless: true,
  // Force CPU compositing — this is the worst case we want to surface.
  args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DPR });
const page = await context.newPage();

await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(500); // let entrance animations / hydration settle

// Sample frame intervals via requestAnimationFrame inside the page.
const result = await page.evaluate(async ({ ms, scroll }) => {
  const frames = [];
  let last = performance.now();
  const start = last;
  let scrolling;
  if (scroll) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    let dir = 1;
    scrolling = setInterval(() => {
      let y = window.scrollY + dir * 24;
      if (y >= max) { y = max; dir = -1; }
      if (y <= 0) { y = 0; dir = 1; }
      window.scrollTo(0, y);
    }, 16);
  }
  await new Promise((resolve) => {
    function tick(now) {
      frames.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
  if (scrolling) clearInterval(scrolling);
  return frames;
}, { ms: MS, scroll: SCROLL });

const intervals = result.slice(1); // drop the first (warm-up) interval
const total = intervals.reduce((a, b) => a + b, 0);
const fps = Math.round((intervals.length / total) * 1000);
const long = intervals.filter((d) => d > LONG_FRAME_MS).length;
const worst = Math.round(Math.max(...intervals));
const sorted = [...intervals].sort((a, b) => a - b);
const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0);

if (SHOT && typeof SHOT === "string") await page.screenshot({ path: SHOT, fullPage: false });

console.log(`${url} @ ${WIDTH}x${HEIGHT} DPR${DPR}, ${MS}ms ${SCROLL ? "scrolling" : "idle"}`);
console.log(`  ~${fps} fps   long(>${LONG_FRAME_MS}ms) frames: ${long}/${intervals.length}   worst: ${worst}ms   p95: ${p95}ms`);
if (SHOT && typeof SHOT === "string") console.log(`  screenshot -> ${SHOT}`);

await browser.close();
