/**
 * Shared harness for the screenshot and smoke scripts: locates the manager
 * binary, seeds a demo data directory, starts the manager and waits for it.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const WEB_DIR = resolve(import.meta.dir, "..");
export const REPO_DIR = resolve(WEB_DIR, "..");
export const PASSWORD = "screenshots-password";

export function findManager(): string {
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

export function seedData(dataDir: string) {
  rmSync(dataDir, { recursive: true, force: true });
  const server = join(dataDir, "server");
  mkdirSync(join(server, "ModConfig"), { recursive: true });
  mkdirSync(join(server, "Mods"), { recursive: true });
  mkdirSync(join(dataDir, "backups"), { recursive: true });
  mkdirSync(join(dataDir, "config"), { recursive: true });

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
    JSON.stringify(
      { enabled: true, radius: 12, dimensions: ["x", "z"], nested: { depth: 3 } },
      null,
      2,
    ),
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

  const versionDir = join(dataDir, "runtime", "vanilla", "1.22.7");
  mkdirSync(versionDir, { recursive: true });
  writeFileSync(join(versionDir, "VintagestoryServer"), "");

  // A fake installed mod (zip with modinfo.json) when the zip CLI is available.
  const modDir = join(server, "Mods");
  writeFileSync(
    join(modDir, "modinfo.json"),
    JSON.stringify({
      modid: "examplemod",
      name: "Example Mod",
      version: "1.2.3",
      authors: ["You"],
    }),
  );
  spawnSync("zip", ["-q", join(modDir, "examplemod_1.2.3.zip"), "modinfo.json"], { cwd: modDir });
  rmSync(join(modDir, "modinfo.json"), { force: true });

  writeFileSync(join(dataDir, "backups", "README.txt"), "screenshot fixture");
  spawnSync(
    "zip",
    ["-q", join(dataDir, "backups", "server-20260101-120000.zip"), "README.txt"],
    { cwd: join(dataDir, "backups") },
  );
  spawnSync(
    "zip",
    ["-q", join(dataDir, "backups", "mods-20260101-120000.zip"), "README.txt"],
    { cwd: join(dataDir, "backups") },
  );
  rmSync(join(dataDir, "backups", "README.txt"), { force: true });

  writeFileSync(
    join(dataDir, "config", "settings.json"),
    JSON.stringify(
      {
        version: "1.22.7",
        flavor: "vanilla",
        auto_start: true,
        auto_restart: true,
        restart_schedule: "04:30",
      },
      null,
      2,
    ),
  );
}

export function startManager(port: number, dataDir: string): ChildProcess {
  if (!existsSync(join(WEB_DIR, "dist", "index.html"))) {
    throw new Error("web/dist missing — run `bun run build` first");
  }
  return spawn(findManager(), [], {
    env: {
      ...process.env,
      VS_DATA: dataDir,
      VS_WEB_PASSWORD: PASSWORD,
      VS_WEB_PORT: String(port),
      VS_WEB_DIST: join(WEB_DIR, "dist"),
      RUST_LOG: "warn",
    },
    stdio: "ignore",
  });
}

export async function waitForHealth(port: number): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
  throw new Error("manager did not become healthy");
}

export function stopManager(child: ChildProcess) {
  child.kill("SIGTERM");
}

export { dirname };
