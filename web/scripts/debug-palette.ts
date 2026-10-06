import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

import { PASSWORD, seedData, startManager, stopManager, waitForHealth } from "./harness";

const PORT = 18096;
const DATA_DIR = join(tmpdir(), "vs-webui-debug");

seedData(DATA_DIR);
const child = startManager(PORT, DATA_DIR);
try {
  await waitForHealth(PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-slot="sidebar"]');
  await page.waitForTimeout(500);

  console.log("pressing ControlOrMeta+k");
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(1000);
  console.log(
    "after keypress:",
    await page.evaluate(() => ({
      dialog: document.querySelectorAll('[data-slot="command-dialog"]').length,
      overlay: document.querySelectorAll('[data-slot="command-overlay"]').length,
    })),
  );

  console.log("dispatching synthetic meta+k");
  await page.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }),
    );
  });
  await page.waitForTimeout(1000);
  console.log(
    "after synthetic:",
    await page.evaluate(() => ({
      dialog: document.querySelectorAll('[data-slot="command-dialog"]').length,
      overlay: document.querySelectorAll('[data-slot="command-overlay"]').length,
      active: document.activeElement?.tagName,
    })),
  );
  await browser.close();
} finally {
  stopManager(child);
}
