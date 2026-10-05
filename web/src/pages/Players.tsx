import { Loader2, ShieldCheck, Users, Wrench } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  usePlayers,
  useServerCommand,
  useSetWhitelistMode,
  useStatus,
} from "@/hooks/use-api";
import { errorMessage, formatDuration } from "@/lib/format";

export default function Players() {
  const players = usePlayers();
  const status = useStatus();
  const command = useServerCommand();
  const mode = useSetWhitelistMode();
  const [newName, setNewName] = useState("");
  const [target, setTarget] = useState("");

  const running = status.data?.status.status === "running";
  const whitelist = players.data?.whitelist;
  const enabled = players.data?.whitelist_enabled ?? null;

  function send(cmd: string) {
    command.mutate(cmd);
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-4">
      {!running && (
        <p className="border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          The server is not running — whitelist and moderation commands need a running server.
        </p>
      )}
      {command.isError && (
        <p className="text-error text-xs">{errorMessage(command.error)}</p>
      )}
      {!command.isError && command.isSuccess && (
        <p className="text-success text-xs">Command sent to the server console.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-text-secondary" />
              Online players
            </CardTitle>
            <CardDescription>
              Best-effort list from server join/leave events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {players.isLoading && !players.data ? (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 className="size-4 animate-spin" />
                Loading…
              </div>
            ) : (players.data?.online.length ?? 0) === 0 ? (
              <p className="text-xs text-text-muted">No players detected.</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {players.data?.online.map((player) => (
                  <li className="flex items-center justify-between gap-3 py-1.5" key={player.name}>
                    <span className="text-xs">{player.name}</span>
                    <span className="font-mono text-[11px] text-text-muted">
                      {formatDuration(Math.max(0, Math.floor(Date.now() / 1000) - player.since))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-4 text-text-secondary" />
              Moderation
            </CardTitle>
            <CardDescription>Send admin commands for a player by name.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mod-target">Player name</Label>
              <Input
                id="mod-target"
                onChange={(event) => setTarget(event.target.value)}
                placeholder="Player name"
                value={target}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/kick ${target.trim()}`)}
                size="sm"
                variant="outline-warning"
              >
                Kick
              </Button>
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/ban ${target.trim()}`)}
                size="sm"
                variant="destructive"
              >
                Ban
              </Button>
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/unban ${target.trim()}`)}
                size="sm"
                variant="outline"
              >
                Unban
              </Button>
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/op ${target.trim()}`)}
                size="sm"
                variant="outline"
              >
                Op
              </Button>
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/deop ${target.trim()}`)}
                size="sm"
                variant="outline"
              >
                Deop
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="self-start lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-text-secondary" />
                Whitelist
              </CardTitle>
              {enabled !== null && (
                <label className="flex items-center gap-2 text-xs text-text-secondary">
                  {enabled ? "Whitelist only" : "Open server"}
                  <Switch
                    checked={enabled}
                    disabled={mode.isPending}
                    onCheckedChange={(checked) => mode.mutate(checked)}
                  />
                </label>
              )}
            </div>
            <CardDescription>
              Changes go through the server's own <span className="font-mono">/player</span>{" "}
              commands and are persisted by the game in{" "}
              <span className="font-mono">playerwhitelist.json</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {enabled === null && (
              <p className="text-xs text-text-muted">
                Whitelist mode is set once <span className="font-mono">serverconfig.json</span>{" "}
                exists (first server start).
              </p>
            )}
            {mode.isSuccess && mode.data?.restart_required && (
              <p className="text-warning text-xs">Saved — restart the server to apply.</p>
            )}
            {mode.isError && <p className="text-error text-xs">{errorMessage(mode.error)}</p>}
            {whitelist?.error && (
              <p className="border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                {whitelist.error}
              </p>
            )}

            {(whitelist?.entries.length ?? 0) > 0 && (
              <div className="divide-y divide-border-subtle border border-border-default">
                {whitelist?.entries.map((entry, index) => (
                  <div className="flex items-center gap-3 px-3 py-2" key={`${entry.uid}-${index}`}>
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {entry.name ?? "(unknown name)"}
                    </span>
                    <span className="hidden truncate font-mono text-[10px] text-text-muted sm:block">
                      {entry.uid ?? ""}
                    </span>
                    <Button
                      disabled={!running || !entry.name}
                      onClick={() => send(`/player ${entry.name} whitelist off`)}
                      size="sm"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-56 flex-1 gap-1.5">
                <Label htmlFor="whitelist-name">Whitelist a player</Label>
                <Input
                  id="whitelist-name"
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Player name"
                  value={newName}
                />
              </div>
              <Button
                disabled={!running || !newName.trim()}
                onClick={() => {
                  send(`/player ${newName.trim()} whitelist on`);
                  setNewName("");
                }}
                size="sm"
                variant="accent-primary"
              >
                Add to whitelist
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
