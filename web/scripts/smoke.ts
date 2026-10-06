/**
 * Browser smoke test: loads every page and exercises interactive Base UI
 * surfaces (language menu, command palette, mod detail sheet), failing on any
 * page error or console error.
 *
 * Requires a built web/dist and manager binary — see harness.ts.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

import { PASSWORD, seedData, startManager, stopManager, waitForHealth } from "./harness";

const PORT = 18097;
const DATA_DIR = join(tmpdir(), "vs-webui-smoke");

const ROUTES = ["/", "/console", "/mods", "/config", "/players", "/backups", "/versions", "/settings"];

async function main() {
  seedData(DATA_DIR);
  const child = startManager(PORT, DATA_DIR);
  const errors: string[] = [];

  try {
    await waitForHealth(PORT);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    await page.goto(`http://localhost:${PORT}/`);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-slot="sidebar"]', { timeout: 10_000 });

    for (const route of ROUTES) {
      await page.goto(`http://localhost:${PORT}${route}`);
      await page.waitForTimeout(900);
      console.log(`visited ${route}`);
    }

    // Language dropdown (Base UI menu with group label).
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(600);
    await page.click('[data-slot="dropdown-menu-trigger"]');
    await page.waitForSelector('[data-slot="dropdown-menu-content"]', { timeout: 5_000 });
    await page.click('[data-slot="dropdown-menu-item"]:has-text("Deutsch")');
    await page.waitForTimeout(500);
    console.log("language menu ok");

    // Command palette.
    await page.keyboard.press("ControlOrMeta+k");
    await page.waitForSelector('[data-slot="command-dialog"]', { timeout: 5_000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    console.log("command palette ok");

    // Mod detail sheet (Base UI dialog) with a virtualized row.
    await page.goto(`http://localhost:${PORT}/mods`);
    await page.waitForTimeout(1500);
    await page.click("button:has-text('BetterRuins')");
    await page.waitForSelector('[data-slot="sheet-content"]', { timeout: 5_000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    console.log("mod sheet ok");

    await browser.close();
  } finally {
    stopManager(child);
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} browser error(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log("\nsmoke ok — no page/console errors");
}

await main();
