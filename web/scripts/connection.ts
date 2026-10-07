/**
 * Connection-loss regression test: kills the manager while a browser session
 * is open, expects the blocking overlay (app inert), then restarts the
 * manager and expects the overlay to clear on its own.
 *
 * Requires a built web/dist and manager binary — see harness.ts.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

import { PASSWORD, seedData, startManager, stopManager, waitForHealth } from "./harness";

const PORT = 18098;
const DATA_DIR = join(tmpdir(), "vs-webui-connection");

seedData(DATA_DIR);
let manager = startManager(PORT, DATA_DIR);
await waitForHealth(PORT);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector("#password", { timeout: 10_000 });
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-slot="sidebar"]', { timeout: 10_000 });
  await page.waitForTimeout(1500);

  if ((await page.locator("text=Connection lost").count()) > 0) {
    throw new Error("overlay visible while the manager is up");
  }

  // Kill the manager: the client must notice and block the app.
  stopManager(manager);
  await page.waitForSelector("text=Connection lost", { timeout: 20_000 });
  await page.waitForTimeout(500);
  const inert = await page.evaluate(() => document.querySelector("[inert]") !== null);
  if (!inert) {
    throw new Error("app was not made inert while offline");
  }
  console.log("offline overlay + inert ok");

  // Restart: the overlay must clear without a reload.
  manager = startManager(PORT, DATA_DIR);
  await waitForHealth(PORT);
  await page.waitForSelector("text=Connection lost", { state: "detached", timeout: 45_000 });
  console.log("reconnected automatically");

  if (errors.length > 0) {
    console.error(`browser error(s): ${errors.join("; ")}`);
    process.exit(1);
  }
  console.log("connection test ok");
} finally {
  stopManager(manager);
  await browser.close();
}
