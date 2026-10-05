# vs-webui

Vintage Story dedicated server in a single Docker container with a browser UI inspired by
[Story Forge](../Tauri/storyforge). Manage the server, browse and update mods from the
Vintage Story mod database, edit mod configs, and run either the vanilla dedicated server or
[Stratum](https://stratumvs.dev), the patched high-performance server runtime.

## Quick start

```sh
docker compose up -d --build
```

Open `http://localhost:8080`, log in with `VS_WEB_PASSWORD` (or the generated password printed
in `docker compose logs vs-webui` on first boot), then install a game version under **Versions**
and press **Start**.

Game clients connect to `<host>:42420`.

## Screenshots

Captured headlessly by `bun run screenshots` (Playwright, 1200×800), English and German:

| Dashboard | Mods |
| :---: | :---: |
| ![Dashboard](web/screenshots/dashboard.png) | ![Mods](web/screenshots/mods.png) |

More under [`web/screenshots/`](web/screenshots/) (`de/` holds the German pass).

## Environment

| Variable            | Default   | Description                                                   |
| ------------------- | --------- | ------------------------------------------------------------- |
| `VS_WEB_PASSWORD`   | generated | Web UI password (generated and logged once if unset)          |
| `VS_WEB_AUTH`       | `password`| `password` or `off` (use behind an authenticating reverse proxy) |
| `VS_WEB_PORT`       | `8080`    | Web UI port inside the container                              |
| `VS_DATA`           | `/data`   | Persistent data root (server files, worlds, mods, backups)    |
| `VS_VERSION`        | `latest`  | Initial game version to install on first boot (`latest` or e.g. `1.22.7`) |
| `VS_AUTO_INSTALL`   | `false`   | Install the game version on first boot                        |
| `VS_AUTO_START`     | `false`   | Start the server when the manager boots                       |
| `VS_SECURE_COOKIE`  | `false`   | Set `Secure` on the session cookie (HTTPS deployments)        |

## Data layout

```
/data
  config/                manager settings, auth, sessions
  runtime/vanilla/<v>/   installed server builds
  server/                data path: serverconfig.json, Mods/, ModConfig/, Saves/, Logs/
  backups/               backups (phase 5)
```

## Status

Phase 1 (manager core), Phase 2 (mods), Phase 3 (config editors), Phase 4 (Stratum) and
Phase 5 (players, scheduled restarts, backups) implemented. The UI ships in 7 languages
(English, German, Spanish, French, Brazilian Portuguese, Russian, Simplified Chinese) and
`bun run screenshots` refreshes the captures in `web/screenshots/`.

Phase 1 verified end-to-end in the built linux/amd64 image: auto-install of VS 1.22.7,
server reaching `running`, live console, graceful `/stop` shutdown on `docker stop`.
Phase 2 verified live against ModDB: browsing, dependency-aware install, update-all, remove,
pins and automatic backups. Phase 3 verified locally: ModConfig listing/editing (live +
Monaco), JSON5 validation, path-traversal rejection and the serverconfig form. Phase 4
verified in-container: Stratum one-click install, first-run bootstrap + patch to `running`,
config editing with `/stratum reload`, graceful stop. Phase 5 verified locally and
in-container: players/whitelist endpoints, server + mods backups
(create/download/restore/delete) and the daily restart schedule.

## Development

```sh
# manager (needs no dotnet for `cargo check`; running requires a VS server install)
cd server && cargo run

# web UI (proxies /api to localhost:8080)
cd web && bun install && bun run dev
```
