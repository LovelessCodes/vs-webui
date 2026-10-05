# vs-webui — Vintage Story server Docker image with web UI

Single-container Vintage Story dedicated server with a browser UI inspired by Story Forge.
Supports vanilla and **Stratum** (patched server runtime) flavors, mod browsing/updating and
mod config editing.

Status: phase 1 (manager core) implemented. Phase progress at the bottom of this file.

## Decisions

| Topic         | Decision                                                                     |
| ------------- | ---------------------------------------------------------------------------- |
| Backend       | Rust (axum + tokio), ported from `../Tauri/storyforge/src-tauri/src/modules` |
| Frontend      | React 19 + Vite + TanStack Router/Query + Tailwind v4 + Base UI, ported from storyforge |
| Auth          | Password required by default (env `VS_WEB_PASSWORD` or generated on first run, printed to logs) |
| Scope v1      | Console, settings, mods, mod configs, Stratum (phases 1–4)                   |
| Container     | One server instance per container, non-root, `/data` volume                  |
| Architecture  | linux/amd64 only (vanilla server manifest is x64)                            |

## Container architecture

```
┌─ container ─────────────────────────────────────────────┐
│ manager (Rust/axum, uid 1000, PID 1 under tini)         │
│   ├─ serves SPA + REST API + SSE (console, downloads)   │
│   ├─ installs/verifies game builds, supervises server   │
│   ├─ child: VintagestoryServer  OR  StratumServer       │
│   │           --dataPath /data/server                   │
│   └─ .NET runtime 10 (.NET 8 side-by-side later for 1.21) │
└─────────────────────────────────────────────────────────┘
ports: 42420/tcp+udp (game), 8080/tcp (web UI)   volume: /data
```

Base image `mcr.microsoft.com/dotnet/runtime:10.0-noble` + `tini` + `ca-certificates`.

### /data layout

```
/data
  config/                 manager state, secrets, sessions
  runtime/
    vanilla/<version>/    verified VS server builds
    stratum/<tag>/        Stratum launcher builds (patched runtime)
  server/                 active data path: serverconfig.json, playerwhitelist.json,
                          Mods/, Mods-disabled/, ModConfig/, Saves/, Logs/
  backups/                zips (manual, pre-update, scheduled)
```

### Environment

| Var                | Default         | Meaning                                        |
| ------------------ | --------------- | ---------------------------------------------- |
| `VS_VERSION`       | `latest`        | Vanilla version to install (`latest`/`1.22.7`) |
| `VS_FLAVOR`        | `vanilla`       | `vanilla` or `stratum`                         |
| `VS_AUTO_INSTALL`  | `false`         | Install build + start on first boot            |
| `VS_AUTO_START`    | `false`         | Start server when manager boots                |
| `VS_WEB_PASSWORD`  | unset           | UI password; generated + logged if unset       |
| `VS_WEB_AUTH`      | `password`      | `password` or `off` (reverse-proxy setups)     |
| `VS_WEB_PORT`      | `8080`          | UI port                                        |

## Distribution facts

- Vanilla manifest: `https://api.vintagestory.at/{stable,unstable,stable-unstable,pre}.json`,
  key `linuxserver` → `vs_server_linux-x64_<v>.tar.gz` (CDN + md5).
- Version → .NET: 1.22.x → 10, 1.21.x → 8, older → 7 (`dotnet.rs` mapping in storyforge).
- Stratum: GitHub releases `StratumServer/Stratum`, asset `stratum-<ver>-linux-x64.zip`
  (tag encodes base VS version, e.g. `v1.22.7-stratum.2`). Launcher bootstraps vanilla files
  on first start; flags `--dataPath`, `--stratum-refresh`, `--stratum-skip-bootstrap`.
  Configs: `stratum.json`, `stratum-commands.json`, `stratum-performance.json`; apply with
  `/stratum reload` (some settings need restart).
- ModDB: `mods.vintagestory.at/api/{mods,mod/<id>,tags,updates?mods=…}`; release `mainfile`
  is a full download URL. Dependencies in zip `modinfo.json`.
- Control surface: server stdin (`/stop`, `/announce`, `/kick`, …), stdout/stderr logs,
  `serverconfig.json`, `playerwhitelist.json`, `ModConfig/*.json`.
- Graceful stop: `/stop` → wait 10s → SIGTERM process group → wait 5s → kill
  (mirrors storyforge `server_hosting_actor.rs`).

## Repo layout

```
vs-webui/
  server/              Rust axum workspace
    src/main.rs        app, auth, static, SSE
    src/state.rs
    src/api/           route handlers per area
    src/domain/
      versions.rs      Anego manifest, download/verify/install
      hosting.rs       instance state, whitelist, serverconfig
      actor.rs         process spawn, stdin/stdout, status
      mods.rs          ModDB client, zip scan, dependencies
      downloads.rs     resumable download queue
      configs.rs       ModConfig / serverconfig / Stratum JSON
      stratum.rs       GitHub releases, install/update
      backups.rs       zip create/restore/retention
  web/                 React SPA (ported storyforge UI)
    src/components/{ui,layout,dashboard,console,mods,configs,settings,versions,players,backups}/
    src/lib/api.ts     fetch client + SSE (replaces @tauri-apps/api invoke)
    src/hooks/         TanStack Query hooks against HTTP API
  docker/Dockerfile
  compose.yaml
  .github/workflows/build.yml
  PLAN.md / README.md
```

## Dockerfile sketch

```dockerfile
FROM oven/bun:1 AS web
COPY web/ /web/ && WORKDIR /web
RUN bun install --frozen-lockfile && bun run build

FROM rust:1.85-bookworm AS server
COPY server/ /src/ && WORKDIR /src
RUN cargo build --release

FROM mcr.microsoft.com/dotnet/runtime:10.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=server /src/target/release/vs-webui-manager /app/manager
COPY --from=web /web/dist /app/web
ENV VS_DATA=/data VS_WEB_PORT=8080
VOLUME /data
EXPOSE 42420/tcp 42420/udp 8080/tcp
ENTRYPOINT ["/usr/bin/tini","--","/app/manager"]
```

## API surface (v1)

```
GET  /api/health
POST /api/login | /api/logout          GET /api/me
GET  /api/status
POST /api/server/start | stop | restart | command
GET  /api/console/history | /api/console/stream (SSE)
GET  /api/versions                     POST /api/versions/install
POST /api/server/version               POST /api/server/flavor
GET  /api/stratum/releases             POST /api/stratum/install
GET  /api/mods/installed               POST /api/mods/install | remove
GET  /api/mods/updates                 POST /api/mods/update-all
GET  /api/modb/search | tags | mod/:id
GET  /api/configs | /api/configs/:file   PUT /api/configs/:file
GET  /api/serverconfig                   PUT /api/serverconfig
GET  /api/whitelist  POST /api/whitelist  DELETE /api/whitelist/:uid
GET  /api/players
GET  /api/backups  POST /api/backups  POST /api/backups/:id/restore
GET  /api/downloads/stream (SSE)
```

Auth: argon2 password, signed HttpOnly cookie sessions, CSRF double-submit token for
mutations, login rate limiting. `VS_WEB_AUTH=off` disables (documented for reverse proxies).

## Web UI pages (storyforge look & feel)

Design vocabulary from `storyforge/PORTING.md`: sharp corners, right-side Sheets for forms,
`accent-primary` actions, persistent header, light/dark, command palette (⌘K).

1. **Dashboard** — status, uptime, online players, version/flavor, quick actions, update notices.
2. **Console** — live SSE log, command input with history, start/stop/restart.
3. **Mods** — Browse (ModDB search, filters by game version/tags/side/author, dependency-aware
   install queue), Installed (update / downgrade / remove, Update All, pins, enable/disable by
   moving to `Mods-disabled/`, broken-mod and missing-dependency banners).
4. **Mod Configs** — `ModConfig/*.json` browser, Live editor + Monaco code editor
   (ported `ConfigPage`/`LiveEditor`/`CodeEditor`).
5. **Server Settings** — `serverconfig.json` form + raw JSON, restart-required banner.
6. **Versions & Flavor** — stable/unstable channel picker, install/switch vanilla,
   Stratum release list + one-click install/update, mismatch warnings.
7. **Stratum** (when flavor=stratum) — editors for the three Stratum configs + reload button.
8. **Backups** — create/list/download/restore/delete, retention, auto-backup before mod changes.
9. **Settings** — password change, auto-restart, scheduled restarts with `/announce` warnings,
   theme, timezone.

## Phases

### Phase 1 — image + manager core ✅ implemented

- [x] Repo scaffold, Dockerfile, compose, GHCR workflow
- [x] Auth (argon2, cookie sessions, CSRF, login rate limit, `VS_WEB_AUTH=off`)
- [x] `/data` bootstrap, default `serverconfig.json`
- [x] Version install: manifest fetch, streaming download, MD5 verify, tar.gz extract
- [x] Process supervisor: spawn `--dataPath`, piped stdio, startup detection, graceful
      `/stop` → SIGTERM → kill escalation, auto-restart with failure cap
- [x] Console: ring buffer + SSE stream + command input (history, follow mode)
- [x] Web UI: login, dashboard, console, versions, settings (storyforge look & feel)
- [x] Local verification: auth/CSRF, manifest listing, real 1.22.7 install
      (download → md5 → extract), supervisor crash detection
- Notes: UI currently ships a hand-built component set in the storyforge palette;
      Base UI / Monaco land with the features that need them (mods, config editors).
      `linuxserver` builds are linux-x64 only — the image is linux/amd64.
- Notes: the manager never pre-seeds `serverconfig.json` — Vintage Story generates the
      complete file (roles, world config) on first start, and a partial file makes it
      refuse to boot. The UI reads it back once it exists.

### Phase 2 — mods ✅ implemented

- [x] Installed mod scan (zip `modinfo.json`, json5-tolerant, broken-zip errors)
- [x] ModDB browse: search, game-version/side/tag filters, sorting, pagination, detail sheet
      with release list
- [x] Install / update / downgrade / remove; recursive dependency queue with
      minimum-version release picking (fixed prerelease comparison, e.g. dev.26 > dev.1)
- [x] Update All + per-mod pins (pinned mods excluded from update checks and Update All)
- [x] Job queue with progress UI; broken-mod and missing-dependency banners
- [x] Automatic `Mods` backups before every change (zip in `/data/backups`, newest 10 kept)
- Notes: job progress is polled (`/api/mods/jobs`, 1s while active) — SSE upgrade only if
      it becomes necessary. Modpacks/cloud accounts remain out of scope.
- Verified live against ModDB: Expanded Foods install auto-queued A Culinary Artillery
      (dependency), update-all moved both to the newest dev builds and removed old files,
      remove + pin + CSRF checks pass.

### Phase 3 — configs ✅ implemented

- [x] `ModConfig/*.json` browser with file list, read errors and empty state
- [x] Live editor: recursive form for objects/arrays/primitives with debounced auto-save
      (600ms) and JSON5 validation server-side before writing
- [x] Monaco code editor (bundled locally, no CDN; lazy-loaded 4MB chunk) with explicit
      save and unsaved indicator
- [x] `serverconfig.json` form editor (name, ports, limits, whitelist, PvP, advertise…)
      merging only changed fields, plus a raw JSON tab
- Verified locally: JSON5 files list/save, invalid content rejected (400), path traversal
      rejected, missing serverconfig handled ("generated on first start")

### Phase 4 — Stratum

- Flavor switch, GitHub release listing (tag ↔ base VS version), install/update
- Stratum config editors (`stratum.json`, `stratum-commands.json`,
  `stratum-performance.json`) + `/stratum reload`

### Phase 5 — parity & polish

- Players/whitelist/moderation, scheduled restarts, i18n (port storyforge catalogs),
  screenshots, docs

## Verification

- Unit: version compare, dependency resolution, config validation (ported storyforge tests).
- Integration: build image → first boot installs VS 1.22.x → start server → health + console
  assert → install a small server-side mod → file present in `/data/server/Mods` → `/stop`.
- CI: `cargo test`, `bun test`, `docker build`, GHCR push on tags.

## Non-goals (v1)

Modpacks/cloud accounts, world/map viewer, multi-instance per container, arm64.

## Risks / verify during build

- Stratum arm64 bootstrap (vanilla manifest has x64 only) — stays out of scope until verified.
- .NET runtime selection for 1.21 and older initially unsupported.
- Stratum's exact config folder on Linux servers (scan data path + `ModConfig/` at runtime).
- ModDB API is unofficial; isolate client behind one module for easy fixes.
