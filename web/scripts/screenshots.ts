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
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";

const WEB_DIR = resolve(import.meta.dir, "..");
const REPO_DIR = resolve(WEB_DIR, "..");
const OUT_DIR = join(WEB_DIR, "screenshots");
const DATA_DIR = join(tmpdir(), "vs-webui-screenshots");
const PORT = 18099;
const PASSWORD = "screenshots-password";

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

function findManager(): string {
  const candidates = [
    process.env.VS_WEBUI_MANAGER,
    join(REPO_DIR, "server", "target", "release", "vs-webui-manager"),
    join(REPO_DIR, "server", "target", "debug", "vs-webui-manager"),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("manager binary not found — run `cargo build` in server/ first");
}

function seedData() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  const server = join(DATA_DIR, "server");
  mkdirSync(join(server, "ModConfig"), { recursive: true });
  mkdirSync(join(server, "Mods"), { recursive: true });
  mkdirSync(join(DATA_DIR, "backups"), { recursive: true });
  mkdirSync(join(DATA_DIR, "config"), { recursive: true });

  writeFileSync(
    join(server, "serverconfig.json"),
    JSON.stringify(
      {
        ConfigVersion: "1.10",
        ServerName: "Ember Hollow",
        ServerDescription: "A cozy survival server",
        WelcomeMessage: "Welcome {0}!",
        Port: 42420,
        MaxClients: 16,
        Password: "",
        WhitelistMode: 0,
        OnlyWhitelisted: true,
        VerifyPlayerAuth: true,
        AllowPvP: false,
        AllowFireSpread: true,
        AdvertiseServer: false,
        Upnp: false,
        PassTimeWhenEmpty: false,
        MaxChunkRadius: 12,
        ServerLanguage: "en",
        MaxClientsInQueue: 0,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(server, "ModConfig", "examplemod.json"),
    JSON.stringify({ enabled: true, radius: 12, dimensions: ["x", "z"], nested: { depth: 3 } }, null, 2),
  );
  writeFileSync(
    join(server, "ModConfig", "toolconfig.json"),
    JSON.stringify({ mode: "fast", speed: 1.5 }, null, 2),
  );
  writeFileSync(
    join(server, "playerwhitelist.json"),
    JSON.stringify(
      [
        { PlayerUID: "6f3d0a0b1c2d4e5f6a7b8c9d0e1f2a3b", PlayerName: "Ayla" },
        { PlayerUID: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", PlayerName: "Bram" },
      ],
      null,
      2,
    ),
  );

  // A fake installed version so the dashboard shows a ready server.
  const versionDir = join(DATA_DIR, "runtime", "vanilla", "1.22.7");
  mkdirSync(versionDir, { recursive: true });
  writeFileSync(join(versionDir, "VintagestoryServer"), "");

  // A fake installed mod (zip with modinfo.json) when the zip CLI is available.
  const modDir = join(server, "Mods");
  writeFileSync(
    join(modDir, "modinfo.json"),
    JSON.stringify({ modid: "examplemod", name: "Example Mod", version: "1.2.3", authors: ["You"] }),
  );
  spawnSync("zip", ["-q", join(modDir, "examplemod_1.2.3.zip"), "modinfo.json"], { cwd: modDir });
  rmSync(join(modDir, "modinfo.json"), { force: true });

  // Fake backups for the backups page.
  writeFileSync(join(DATA_DIR, "backups", "README.txt"), "screenshot fixture");
  spawnSync(
    "zip",
    [
      "-q",
      join(DATA_DIR, "backups", "server-20260101-120000.zip"),
      "README.txt",
    ],
    { cwd: join(DATA_DIR, "backups") },
  );
  spawnSync(
    "zip",
    ["-q", join(DATA_DIR, "backups", "mods-20260101-120000.zip"), "README.txt"],
    { cwd: join(DATA_DIR, "backups") },
  );
  rmSync(join(DATA_DIR, "backups", "README.txt"), { force: true });

  writeFileSync(
    join(DATA_DIR, "config", "settings.json"),
    JSON.stringify(
      { version: "1.22.7", flavor: "vanilla", auto_start: true, auto_restart: true, restart_schedule: "04:30" },
      null,
      2,
    ),
  );
}

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://localhost:${PORT}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
  throw new Error("manager did not become healthy");
}

async function main() {
  const manager = findManager();
  if (!existsSync(join(WEB_DIR, "dist", "index.html"))) {
    throw new Error("web/dist missing — run `bun run build` first");
  }
  seedData();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, "de"), { recursive: true });

  const child = spawn(manager, [], {
    env: {
      ...process.env,
      VS_DATA: DATA_DIR,
      VS_WEB_PASSWORD: PASSWORD,
      VS_WEB_PORT: String(PORT),
      VS_WEB_DIST: join(WEB_DIR, "dist"),
      RUST_LOG: "warn",
    },
    stdio: "ignore",
  });

  try {
    await waitForHealth();

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
    child.kill("SIGTERM");
    await Bun.sleep(1000);
    if (!child.killed) child.kill("SIGKILL");
  }

  console.log(`done — screenshots in ${OUT_DIR}`);
}

await main();
