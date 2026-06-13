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
await sleep(2500); // pieces (GLB) load
await shot(page, "board");

// Drive moves to a capture to inspect the battle cinematic.
const move = async (f, t) => {
  await page.evaluate(async (f, t) => {
    await window.__bc.controller.testMove(f, t);
  }, f, t);
};
await move("e2", "e4");
await sleep(700);
await move("d7", "d5");
await sleep(700);
// e4 x d5 -> capture battle
await page.evaluate((f, t) => { window.__bc.controller.testMove(f, t); }, "e4", "d5");
await sleep(700);
await shot(page, "battle1");
await sleep(700);
await shot(page, "battle2");
await sleep(900);
await shot(page, "battle3");
await sleep(1200);
await shot(page, "after");

await browser.close();
console.log("done");
