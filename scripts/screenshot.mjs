import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";

const URL = process.env.URL || "http://localhost:4173/";
const shot = async (page, name) => {
  await page.screenshot({ path: `/tmp/${name}.png` });
  console.log("shot:", name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 892, deviceScaleFactor: 2 });
page.on("console", (m) => console.log("PAGE:", m.type(), m.text()));
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await sleep(800);
await shot(page, "menu");

// Click "Local 2-Player"
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Local/i.test(x.textContent || ""));
  b?.click();
});
await sleep(8000); // characters (GLB) load + spawn
await shot(page, "board");

// Drive moves to a capture to inspect the battle cinematic.
const move = async (f, t) => {
  await page.evaluate((f, t) => window.__bc.controller.testMove(f, t), f, t);
};
// Long-range caster capture — the hardest case to frame: the queen must
// march from h5 to f7 and duel toe-to-toe.
await move("e2", "e4");
await sleep(400);
await move("e7", "e5");
await sleep(400);
await move("d1", "h5");
await sleep(700);
await move("b8", "c6");
await sleep(400);
// Qh5 x f7 -> capture battle (fire and forget, screenshot through it)
await page.evaluate((f, t) => { window.__bc.controller.testMove(f, t); }, "h5", "f7");
for (let i = 1; i <= 7; i++) {
  await sleep(1000);
  await shot(page, `battle${i}`);
}
await sleep(1500);
await shot(page, "after");

await browser.close();
console.log("done");
