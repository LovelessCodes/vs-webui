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

const ROUTES = ["/", "/console", "/chat", "/mods", "/config", "/players", "/backups", "/worlds", "/versions", "/settings"];

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

    // World creation wizard: configure a world that the server would generate
    // on its next start, then confirm the pending entry appears.
    await page.goto(`http://localhost:${PORT}/worlds`);
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Create world" }).first().click();
    await page.waitForSelector('[data-slot="sheet-content"]', { timeout: 5_000 });
    await page.fill("#world-name", "Smoke World");
    await page.fill("#world-seed", "smoke-seed");
    await page.getByRole("button", { name: /World generation/ }).click();
    await page.waitForTimeout(200);
    await page
      .locator('[data-slot="sheet-content"] button')
      .filter({ hasText: "Create world" })
      .last()
      .click();
    await page.waitForSelector("text=Pending creation", { timeout: 5_000 });
    await page.waitForTimeout(400);
    console.log("world wizard ok");

    // Users + audit log (owner): add an operator account, then confirm the
    // mutation is visible in the audit card.
    await page.goto(`http://localhost:${PORT}/settings`);
    await page.waitForSelector("#user-name", { timeout: 10_000 });
    await page.fill("#user-name", "smoke-mod");
    await page.fill("#user-password", "smoke-mod-password");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.waitForSelector("text=smoke-mod", { timeout: 5_000 });
    await page.getByRole("button", { name: "Refresh" }).last().click();
    await page.waitForSelector("text=api/users", { timeout: 5_000 });
    await page.waitForSelector("text=Threshold alerts", { timeout: 5_000 });
    await page.waitForSelector("text=Two-factor authentication", { timeout: 5_000 });
    await page.waitForSelector("text=Active sessions", { timeout: 5_000 });
    await page.waitForSelector("text=Scheduled tasks", { timeout: 5_000 });
    await page.waitForSelector("text=Offsite mirror", { timeout: 5_000 });
    console.log("users + audit + alerts + sessions + schedule + offsite ok");

    // Notification bell (empty history on a fresh data dir).
    await page.getByRole("button", { name: "Notifications" }).click();
    await page.waitForSelector("text=No notifications yet.", { timeout: 5_000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    console.log("notification bell ok");

    // Chat page renders (no server running in the smoke fixture).
    await page.goto(`http://localhost:${PORT}/chat`);
    await page.waitForSelector("text=No chat yet", { timeout: 5_000 });
    console.log("chat page ok");

    // Players page shows the bans card.
    await page.goto(`http://localhost:${PORT}/players`);
    await page.waitForSelector("text=Bans", { timeout: 5_000 });
    console.log("players bans ok");

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

    // Mod detail sheet (Base UI dialog) with a virtualized row (search first —
    // off-screen virtualized rows are not mounted).
    await page.goto(`http://localhost:${PORT}/mods`);
    await page.waitForSelector('[data-slot="input-group-control"]', { timeout: 10_000 });
    await page.fill('[data-slot="input-group-control"]', "BetterRuins");
    await page.waitForSelector('[data-slot="mod-row-summary"]', { timeout: 15_000 });
    await page.click('[data-slot="mod-row-summary"]');
    await page.waitForSelector('[data-slot="sheet-content"]', { timeout: 5_000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    console.log("mod sheet ok");

    await browser.close();
  } catch (error) {
    console.error(`\nsmoke failed: ${error}`);
    for (const entry of errors) console.error(`  - ${entry}`);
    stopManager(child);
    process.exit(1);
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
