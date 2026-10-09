# vs-webui — Vintage Story server Docker image with web UI

Single-container Vintage Story dedicated server with a browser UI inspired by Story Forge.
Supports vanilla and **Stratum** (patched server runtime) flavors, mod browsing/updating and
mod config editing.

Status: phases 1–5 implemented. Phase 6 (post-v1 backlog) is in progress — world creation
wizard, user accounts & roles, audit log, threshold alerts, crash diagnostics and the
notification history are done. Phase progress at the bottom of this file.

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

### Phase 4 — Stratum ✅ implemented

- [x] GitHub release listing (linux-x64 asset), tag → base VS version parsing, cached
- [x] One-click install: download + extract (executable bit set), activates flavor
- [x] Flavor switch (vanilla/stratum) with install validation and restart notice
- [x] Supervisor starts `StratumServer` from its own directory with `--dataPath`;
      status label is the release tag
- [x] Stratum config editor tab (`stratum*.json` in the data path) with a
      `/stratum reload` button
- [x] UI: flavor switch + Stratum release list on Versions, dashboard shows the active tag
- Verified: release parsing, install (10.2 MB, executable), flavor switch, config
      list/save/reject locally; in-container: install → start bootstrapped vanilla 1.22.7
      (9637 files) and applied 10 patched files → `running`, all three config files created,
      `/stratum reload` applied ("config reloaded; preflight passed"), graceful stop saved
      the world

### Phase 5 — parity & polish ✅ implemented (i18n deferred)

- [x] Players page: online list (console join/leave tracking), whitelist entries
      (tolerant read of both `uid`/`PlayerUID` shapes), whitelist mode switch
      (`OnlyWhitelisted` or legacy `WhitelistMode`)
- [x] Moderation: kick/ban/unban/op/deop via console commands
- [x] Daily restart schedule (`HH:MM` local) with 5- and 1-minute `/announce` warnings
- [x] Backups page: create (server data / mods), list, download, restore (stopped server
      only; mods archives restore into `Mods/`), delete; automatic mod backups retained
- [x] Sidebar/header wiring; settings schedule field
- [x] i18n: i18next with 7 locales (English, German, Spanish, French, Brazilian
      Portuguese, Russian, Simplified Chinese), browser detection + switcher in the
      sidebar, catalogs at exact key parity
- [x] Screenshot pipeline: Playwright captures every page at 1200×800 in English and
      German into `web/screenshots/` (`bun run screenshots`)
- Verified locally: whitelist shapes, mode flip (modern + legacy), backup zip contents
      (Logs excluded), restore, download, delete, schedule validation; in-container smoke
      test of players/backups endpoints; screenshot pipeline run end-to-end

### Phase 6 — post-v1 backlog (toward "fantastic") 🚧 planned

Gap analysis for team- and community-run servers, from a full review of phases 1–5. Order
within a theme is value order; nothing here is scheduled yet. Non-goals stay as documented
at the bottom of this file.

#### Access & trust

- [x] **User accounts & roles** — owner/operator/viewer accounts with per-user passwords and
      sessions; viewers get a read-only UI and cannot mutate. The legacy single-password file
      migrates into the first owner; tokens act as operators.
- [x] **Scoped API tokens** — read-only vs full scope so dashboards and scrapers can poll
      `/api/*` without being able to stop the server or change settings. Read-only tokens are
      rejected for every mutating request (own session endpoints aside).
- [x] **Audit log** — append-only record of mutations (start/stop/restart, config saves, restores,
      mod changes, token create/revoke) with actor (user or token label), timestamp and origin;
      browsable under Settings with filtering. Implemented as a mutation middleware plus
      explicit login records; JSONL in `/data/config/audit.jsonl`.
- [x] **Session management & 2FA** — list active sessions with IP, client and last-seen, revoke
      one or all (owners see every account); optional TOTP two-factor with a replay guard,
      one-time recovery codes and an owner-side reset for lost devices.

#### World lifecycle

- [x] **World creation wizard** — pick name, seed, world type, climate/oceans/landform and the
      other `WorldGen` fields *before* first boot; write them into `serverconfig.json` so the
      engine creates the requested world instead of defaults. Bootstraps a complete-enough
      config (bundled 1.22.x default roles) when the server has never run; the configured
      world shows as a pending entry until the server generates it.
- [ ] **Edit inactive worlds** — the engine keeps existing-world settings inside the save (a
      protobuf blob) and reads `serverconfig.json > WorldConfig` only at world creation, so the
      settings sheet is now explicit about being a creation template. Follow-up: live editing of
      the running world via `/worldconfig` commands (read values through the console probe).
- [x] **Duplicate / rename world** — copy a `.vcdbs` plus SQLite sidecars (or a legacy folder)
      and rename worlds; the configured world is repointed automatically.
- [x] **Stop-restore-start flow** — one confirmed action that stops the server, restores the
      selected backup and starts again, with progress feedback.

#### Alerting depth

- [x] **Threshold alerts** — webhook and in-app alert when TPS stays below a configured floor,
      free disk drops below a threshold, or a scheduled backup fails. Fires once on crossing
      and once on recovery; checked every minute (disk every five).
- [x] **Crash diagnostics payload** — include exit code, uptime and the last N console lines
      (tail of `server-main.txt`) in the `crash` notification.
- [x] **Notification history** — persist fired notifications/events with unread state in a bell
      menu instead of transient toasts only. `/data/config/notifications.json`, 200 entries.

#### Backups

- [x] **Offsite targets** — mirror completed backups to S3-compatible storage or WebDAV
      (credentials in settings); schedule and retention shared with local backups. Uploads run
      after every finished backup; failures raise an `offsite_failed` alert, and a Test button
      verifies the target. S3 uses hand-rolled SigV4 validated against the AWS documentation
      example.
- [x] **Integrity verification** — zip-walk check after creation (creation fails and removes the
      archive when the check fails); a Verify action does the full CRC walk on demand, results
      are persisted and surfaced in the UI, and corrupt archives are excluded from count-based
      retention (kept for inspection, never counted as valid backups).
- [x] **Size-based retention** — optional max total backup size in addition to count; oldest
      archives are removed first and the newest is never deleted.
- [x] **Pre-runtime-change backups** — automatic backup before version install/switch and flavor
      changes (mirrors the existing pre-mod-change backups). Aborts the change when the backup
      fails.
- [x] **Restore progress** — stream extraction progress for large world restores; the backups
      page polls a progress endpoint and shows a bar during restore.

#### Scheduling

- [x] **General scheduled tasks** — cron-like tasks (multiple runs per day, weekday sets) for
      restarts, backups and arbitrary console commands/announcements. Managed in
      `settings.tasks`; the legacy single daily restart/backup times migrate on load.
- [x] **One-off scheduled actions** — "restart at 21:00 tonight" without touching the recurring
      schedule; one-off tasks disable themselves after firing.
- [x] **Timezone setting** — explicit IANA timezone for schedules and announcements (defaults to
      container-local time); next occurrences are computed server-side for the dashboard.

#### Community surface

- [ ] **In-game chat view** — parse join/leave and chat lines into a dedicated timeline with
      per-player colors; send messages from the same composer.
- [ ] **Two-way Discord bridge** — optional bot token; relay chat/join/leave to a channel and
      Discord messages back into the game.
- [ ] **Player notes & moderation history** — freeform notes plus kick/ban history per player.
- [ ] **Role/privilege editor** — assign VS roles (whitelisted/moderator/admin) visually instead
      of `op`/`deop` console commands.
- [ ] **Ban list UI** — view and lift persistent bans without the console.
- [ ] **Leaderboard aggregation** — sortable playtime/session aggregates from player history.

#### Observability

- [ ] **Persistent metrics** — persist samples (SQLite or JSONL under `/data/config`) for long
      range charts that survive manager restarts, beyond the 15-minute in-memory window.
- [ ] **More Prometheus metrics + Grafana bundle** — players online, world size, backup age,
      crash count; ship a ready-to-import Grafana dashboard JSON.
- [ ] **Game-port TCP probe** — periodic connect check to port 42420; alert on "process alive
      but unresponsive".

#### Console & diagnostics

- [ ] **Log-file search** — server-side search across `Logs/*.txt` with match navigation.
- [ ] **Level presets & highlighting** — one-click error/warn filters and rule-based
      highlighting in the console.
- [ ] **Post-crash report** — after a crash, automatically surface the first stack trace / last
      error block from the log.
- [ ] **Manager self-update notice** — check GitHub/GHCR for a newer vs-webui image and show an
      update-available notice on the dashboard.

#### Distribution

- [ ] **Serverpack export/import** — one archive with mods (+ versions), ModConfig, relevant
      server config and game version for reproducible setups; import validates and queues the
      installs.

#### Polish

- [ ] **First-run onboarding** — checklist wizard: set password → install version → world
      defaults → start; replaces the "install a version" empty state.
- [ ] **PWA + web push** — installable UI and push notifications for lifecycle/threshold events.
- [ ] **Accessibility audit** — keyboard/focus order, labels, contrast, reduced-motion pass.
- [ ] **Mobile pass** — layout tuning and screenshot coverage below the current 1200×800.

**Suggested first three:** world creation wizard → users/roles + audit log → threshold alerts +
notification history.

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
