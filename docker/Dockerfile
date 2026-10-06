# syntax=docker/dockerfile:1

# ── 1. web UI ────────────────────────────────────────────────────────────────
FROM oven/bun:1 AS web
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# ── 2. manager ───────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS server
WORKDIR /src
COPY server/ ./
RUN cargo build --release --locked

# ── 3. runtime ───────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/runtime:10.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini gosu ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && if id -u 1000 >/dev/null 2>&1; then \
         usermod -l vs -s /usr/sbin/nologin "$(id -nu 1000)"; \
       else \
         useradd --uid 1000 --create-home --shell /usr/sbin/nologin vs; \
       fi \
    && if ! getent group vs >/dev/null; then \
         if getent group 1000 >/dev/null; then \
           groupmod -n vs "$(getent group 1000 | cut -d: -f1)"; \
         else \
           groupadd --gid 1000 vs; \
         fi; \
       fi \
    && usermod -g vs vs \
    && mkdir -p /data \
    && chown vs:vs /data

COPY --from=server /src/target/release/vs-webui-manager /app/manager
COPY --from=web /web/dist /app/web
COPY docker/entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV VS_DATA=/data \
    VS_WEB_PORT=8080 \
    VS_WEB_DIST=/app/web \
    DOTNET_ROOT=/usr/share/dotnet \
    DOTNET_ROLL_FORWARD=LatestMinor \
    DOTNET_ROLL_FORWARD_TO_PRERELEASE=0 \
    RUST_LOG=info

VOLUME /data
EXPOSE 42420/tcp 42420/udp 8080/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -fsS http://localhost:8080/api/health || exit 1

# Starts as root so PUID/PGID can be applied, then drops to `vs`.
WORKDIR /app
ENTRYPOINT ["/usr/bin/tini", "--", "/docker-entrypoint.sh"]
