#!/bin/sh
# Remap the `vs` user/group to PUID/PGID when the container starts as root,
# then drop privileges and exec the manager. Started as a non-root user the
# remap is skipped entirely (PUID/PGID are ignored).
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
    groupmod -o -g "$PGID" vs
    usermod -o -u "$PUID" vs
    chown -R vs:vs /data
    exec gosu vs:vs /app/manager
fi

exec /app/manager
