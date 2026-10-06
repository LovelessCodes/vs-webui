import { AlertTriangle, Loader2, ShieldCheck, Users, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  usePlayerHistory,
  usePlayers,
  useRemoveWhitelistEntry,
  useServerCommand,
  useSetWhitelistMode,
  useStatus,
} from "@/hooks/use-api";
import { errorMessage, formatDuration } from "@/lib/format";

export default function Players() {
  const { t } = useTranslation();
  const players = usePlayers();
  const history = usePlayerHistory();
  const status = useStatus();
  const command = useServerCommand();
  const mode = useSetWhitelistMode();
  const removeEntry = useRemoveWhitelistEntry();
  const [newName, setNewName] = useState("");
  const [target, setTarget] = useState("");

  const running = status.data?.status.status === "running";
  const whitelist = players.data?.whitelist;
  const enabled = players.data?.whitelist_enabled ?? null;
  const known = history.data?.players ?? [];
  const whitelistedNames = new Set(
    (whitelist?.entries ?? [])
      .map((entry) => entry.name?.toLowerCase())
      .filter((name): name is string => Boolean(name)),
  );

  function send(cmd: string) {
    command.mutate(cmd);
  }

  return (
    <ScrollArea className="h-full" scrollFade>
      <div className="flex flex-col gap-4 pb-4 pr-1">
      {!running && (
        <Alert>
          <AlertTriangle />
          <AlertDescription>{t("players.notRunning")}</AlertDescription>
        </Alert>
      )}
      {command.isError && <p className="text-error text-xs">{errorMessage(command.error)}</p>}
      {!command.isError && command.isSuccess && (
        <p className="text-success text-xs">{t("common.commandSent")}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              {t("players.online")}
            </CardTitle>
            <CardDescription>{t("players.onlineDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {players.isLoading && !players.data ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : (players.data?.online.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">{t("players.noPlayers")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {players.data?.online.map((player) => (
                  <li className="flex items-center justify-between gap-3 py-1.5" key={player.name}>
                    <span className="text-xs">{player.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
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
              <Wrench className="size-4 text-muted-foreground" />
              {t("players.moderation")}
            </CardTitle>
            <CardDescription>{t("players.moderationDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mod-target">{t("players.playerName")}</Label>
              <Input
                id="mod-target"
                onChange={(event) => setTarget(event.target.value)}
                placeholder={t("players.playerName")}
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
                {t("players.kick")}
              </Button>
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/ban ${target.trim()}`)}
                size="sm"
                variant="destructive"
              >
                {t("players.ban")}
              </Button>
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/unban ${target.trim()}`)}
                size="sm"
                variant="outline"
              >
                {t("players.unban")}
              </Button>
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/op ${target.trim()}`)}
                size="sm"
                variant="outline"
              >
                {t("players.op")}
              </Button>
              <Button
                disabled={!running || !target.trim()}
                onClick={() => send(`/deop ${target.trim()}`)}
                size="sm"
                variant="outline"
              >
                {t("players.deop")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="self-start lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-muted-foreground" />
                {t("players.whitelist")}
              </CardTitle>
              {enabled !== null && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {enabled ? t("players.whitelistOnly") : t("players.openServer")}
                  <Switch
                    checked={enabled}
                    disabled={mode.isPending}
                    onCheckedChange={(checked) => mode.mutate(checked)}
                  />
                </label>
              )}
            </div>
            <CardDescription>{t("players.whitelistDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {enabled === null && (
              <p className="text-xs text-muted-foreground">{t("players.whitelistModeNote")}</p>
            )}
            {mode.isSuccess && mode.data?.restart_required && (
              <p className="text-warning text-xs">{t("configs.savedRestart")}</p>
            )}
            {mode.isError && <p className="text-error text-xs">{errorMessage(mode.error)}</p>}
            {whitelist?.error && (
              <p className="border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                {t("players.whitelistError")}
              </p>
            )}

            {(whitelist?.entries.length ?? 0) > 0 && (
              <div className="divide-y divide-border border border-border">
                {whitelist?.entries.map((entry, index) => (
                  <div className="flex items-center gap-3 px-3 py-2" key={`${entry.uid}-${index}`}>
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {entry.name ?? t("players.unknownName")}
                    </span>
                    <span className="hidden truncate font-mono text-[10px] text-muted-foreground sm:block">
                      {entry.uid ?? ""}
                    </span>
                    <Button
                      disabled={removeEntry.isPending || (!entry.name && !entry.uid)}
                      onClick={() =>
                        removeEntry.mutate({
                          uid: entry.uid ?? undefined,
                          name: entry.name ?? undefined,
                        })
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {t("common.remove")}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-56 flex-1 gap-1.5">
                <Label htmlFor="whitelist-name">{t("players.whitelistPlayer")}</Label>
                <Input
                  id="whitelist-name"
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder={t("players.playerName")}
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
                {t("players.addToWhitelist")}
              </Button>
            </div>
            {!running && (
              <p className="text-muted-foreground text-[11px]">
                {t("players.whitelistAddHint")}
              </p>
            )}
            {removeEntry.isError && (
              <p className="text-error text-xs">{errorMessage(removeEntry.error)}</p>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              {t("players.knownPlayers")}
            </CardTitle>
            <CardDescription>{t("players.knownPlayersDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {history.isLoading && !history.data && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("common.loading")}
              </div>
            )}
            {history.data && known.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("players.noHistory")}</p>
            )}
            {known.length > 0 && (
              <div className="divide-y divide-border border border-border">
                {known.map((record) => {
                  const whitelisted = whitelistedNames.has(record.name.toLowerCase());
                  return (
                    <div className="flex items-center gap-3 px-3 py-2" key={record.name}>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-xs font-medium">
                          {record.name}
                          {whitelisted && (
                            <Badge className="border-success/40 text-success" variant="outline">
                              {t("players.whitelist")}
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {t("players.firstSeen")}:{" "}
                          {new Date(record.first_seen * 1000).toLocaleDateString()} ·{" "}
                          {t("players.lastSeen")}:{" "}
                          {new Date(record.last_seen * 1000).toLocaleString()} ·{" "}
                          {t("players.playtime")}: {formatDuration(record.seconds)}
                        </p>
                      </div>
                      {!whitelisted && (
                        <Button
                          disabled={!running || command.isPending}
                          onClick={() => send(`/player ${record.name} whitelist on`)}
                          size="sm"
                          variant="outline"
                        >
                          {t("players.addToWhitelist")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
    </ScrollArea>
  );
}
