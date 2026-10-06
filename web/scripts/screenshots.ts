/**
 * Headless screenshot pipeline.
 *
 * Requires:
 *   - `bun run build` (web/dist) and a built manager binary
 *     (server/target/{release,debug}/vs-webui-manager, or VS_WEBUI_MANAGER).
 *   - Playwright chromium (`bunx playwright install chromium`).
 *
 * Captures 1200x800 PNGs of every page in English and German into web/screenshots/.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

import { PASSWORD, seedData, startManager, stopManager, waitForHealth, WEB_DIR } from "./harness";

const PORT = 18099;
const DATA_DIR = join(tmpdir(), "vs-webui-screenshots");
const OUT_DIR = join(WEB_DIR, "screenshots");

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/", name: "dashboard" },
  { path: "/console", name: "console" },
  { path: "/mods", name: "mods" },
  { path: "/config", name: "mod-configs" },
  { path: "/players", name: "players" },
  { path: "/backups", name: "backups" },
  { path: "/versions", name: "versions" },
  { path: "/settings", name: "settings" },
];

async function main() {
  seedData(DATA_DIR);
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, "de"), { recursive: true });

  const child = startManager(PORT, DATA_DIR);

  try {
    await waitForHealth(PORT);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    await page.goto(`http://localhost:${PORT}/`);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-slot="sidebar"]', { timeout: 10_000 });

    for (const pass of ["en", "de"] as const) {
      if (pass === "de") {
        await page.evaluate(() => localStorage.setItem("vs-webui-language", "de"));
      }
      for (const route of ROUTES) {
        await page.goto(`http://localhost:${PORT}${route.path}`);
        await page.waitForTimeout(1200);
        const dir = pass === "en" ? OUT_DIR : join(OUT_DIR, "de");
        const file = join(dir, `${route.name}.png`);
        mkdirSync(dirname(file), { recursive: true });
        await page.screenshot({ path: file });
        console.log(`${pass}: ${route.path} -> ${file}`);
      }
    }

    await browser.close();
  } finally {
    stopManager(child);
    await Bun.sleep(1000);
  }

  console.log(`done — screenshots in ${OUT_DIR}`);
}

await main();
