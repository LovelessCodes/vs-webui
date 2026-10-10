import { AlertTriangle, Ban, ChevronDown, Loader2, ShieldCheck, Users, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  usePlayerBans,
  usePlayerHistory,
  usePlayerProfiles,
  usePlayerRoles,
  usePlayers,
  useRemoveBan,
  useRemoveWhitelistEntry,
  useServerCommand,
  useSetPlayerNote,
  useSetPlayerRole,
  useSetWhitelistMode,
  useStatus,
} from "@/hooks/use-api";
import { errorMessage, formatDuration } from "@/lib/format";
import { cn } from "cn";

type SortBy = "playtime" | "last_seen" | "first_seen" | "name";

export default function Players() {
  const { t } = useTranslation();
  const players = usePlayers();
  const history = usePlayerHistory();
  const profiles = usePlayerProfiles();
  const bans = usePlayerBans();
  const roles = usePlayerRoles();
  const status = useStatus();
  const command = useServerCommand();
  const mode = useSetWhitelistMode();
  const removeEntry = useRemoveWhitelistEntry();
  const setNote = useSetPlayerNote();
  const removeBan = useRemoveBan();
  const setRole = useSetPlayerRole();
  const [newName, setNewName] = useState("");
  const [target, setTarget] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("playtime");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const running = status.data?.status.status === "running";
  const whitelist = players.data?.whitelist;
  const enabled = players.data?.whitelist_enabled ?? null;
  const known = history.data?.players ?? [];
  const whitelistedNames = new Set(
    (whitelist?.entries ?? [])
      .map((entry) => entry.name?.toLowerCase())
      .filter((name): name is string => Boolean(name)),
  );

  const sorted = [...known].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "last_seen":
        return b.last_seen - a.last_seen;
      case "first_seen":
        return b.first_seen - a.first_seen;
      default:
        return b.seconds - a.seconds;
    }
  });

  const roleItems = (roles.data?.roles ?? []).map((role) => ({
    value: role.code,
    label: role.name,
  }));
  const moderationFor = (name: string) =>
    (profiles.data?.moderation ?? []).filter(
      (entry) => entry.player.toLowerCase() === name.toLowerCase(),
    );

  function send(cmd: string) {
    command.mutate(cmd);
  }

  function toggleExpanded(name: string) {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    setNoteDraft(profiles.data?.notes[name]?.text ?? "");
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
                    aria-label={enabled ? t("players.whitelistOnly") : t("players.openServer")}
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

        <Card className="self-start lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                {t("players.knownPlayers")}
              </CardTitle>
              <Select
                items={[
                  { value: "playtime", label: t("players.sortPlaytime") },
                  { value: "last_seen", label: t("players.sortLastSeen") },
                  { value: "first_seen", label: t("players.sortFirstSeen") },
                  { value: "name", label: t("players.sortName") },
                ]}
                onValueChange={(value) => {
                  if (typeof value === "string") setSortBy(value as SortBy);
                }}
                value={sortBy}
              >
                <SelectTrigger aria-label={t("players.sortBy")} size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="playtime">{t("players.sortPlaytime")}</SelectItem>
                  <SelectItem value="last_seen">{t("players.sortLastSeen")}</SelectItem>
                  <SelectItem value="first_seen">{t("players.sortFirstSeen")}</SelectItem>
                  <SelectItem value="name">{t("players.sortName")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            {sorted.length > 0 && (
              <div className="divide-y divide-border border border-border">
                {sorted.map((record, index) => {
                  const whitelisted = whitelistedNames.has(record.name.toLowerCase());
                  const isExpanded = expanded === record.name;
                  const moderation = moderationFor(record.name);
                  const note = profiles.data?.notes[record.name];
                  return (
                    <div key={record.name}>
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                        {sortBy === "playtime" && (
                          <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                            #{index + 1}
                          </span>
                        )}
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
                        {roleItems.length > 0 && (
                          <Select
                            items={roleItems}
                            onValueChange={(value) => {
                              if (typeof value === "string" && value) {
                                setRole.mutate({ name: record.name, code: value });
                              }
                            }}
                            value={roles.data?.assignments[record.name] ?? ""}
                          >
                            <SelectTrigger
                              aria-label={t("players.roleLabel")}
                              size="sm"
                              className="w-36"
                            >
                              <SelectValue placeholder={t("players.roleNone")} />
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false}>
                              {roleItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
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
                        <Button
                          onClick={() => toggleExpanded(record.name)}
                          size="icon-sm"
                          title={t("players.details")}
                          variant="ghost"
                        >
                          <ChevronDown
                            className={cn("transition-transform", isExpanded && "rotate-180")}
                          />
                        </Button>
                      </div>
                      {isExpanded && (
                        <div className="grid gap-4 border-t border-border bg-muted/20 px-4 py-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor={`note-${record.name}`}>{t("players.notes")}</Label>
                            <Textarea
                              id={`note-${record.name}`}
                              onChange={(event) => setNoteDraft(event.target.value)}
                              placeholder={t("players.notesPlaceholder")}
                              rows={2}
                              value={noteDraft}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                disabled={setNote.isPending}
                                onClick={() =>
                                  setNote.mutate({ name: record.name, notes: noteDraft })
                                }
                                size="sm"
                                variant="outline"
                              >
                                {t("common.save")}
                              </Button>
                              {note && note.updated > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {t("players.noteUpdated", {
                                    date: new Date(note.updated * 1000).toLocaleString(),
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="grid gap-1.5">
                            <Label>{t("players.moderationHistory")}</Label>
                            {moderation.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground">
                                {t("players.noModeration")}
                              </p>
                            ) : (
                              <div className="divide-y divide-border border border-border bg-card">
                                {moderation.map((entry, position) => (
                                  <div
                                    className="flex items-center gap-3 px-3 py-1.5 text-[11px]"
                                    key={`${entry.ts}-${position}`}
                                  >
                                    <Badge
                                      variant={
                                        entry.action === "ban"
                                          ? "error"
                                          : entry.action === "unban"
                                            ? "success"
                                            : "outline"
                                      }
                                    >
                                      {entry.action}
                                    </Badge>
                                    <span className="text-muted-foreground">{entry.by}</span>
                                    <span className="ml-auto font-mono text-muted-foreground">
                                      {new Date(entry.ts * 1000).toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="text-[10px] text-muted-foreground">
                              {t("players.moderationHint")}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="self-start lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ban className="size-4 text-muted-foreground" />
              {t("players.bans")}
            </CardTitle>
            <CardDescription>{t("players.bansDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {bans.isLoading && !bans.data && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("common.loading")}
              </div>
            )}
            {bans.data && bans.data.bans.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("players.noBans")}</p>
            )}
            {(bans.data?.bans.length ?? 0) > 0 && (
              <div className="divide-y divide-border border border-border">
                {bans.data?.bans.map((ban, index) => (
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2" key={`${ban.uid}-${index}`}>
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {ban.name ?? ban.uid ?? t("players.unknownName")}
                    </span>
                    {ban.reason && (
                      <span className="hidden max-w-56 truncate text-[10px] text-muted-foreground sm:block">
                        {ban.reason}
                      </span>
                    )}
                    {ban.until && (
                      <span className="hidden font-mono text-[10px] text-muted-foreground md:block">
                        {ban.until}
                      </span>
                    )}
                    <Button
                      disabled={removeBan.isPending || (!ban.name && !ban.uid)}
                      onClick={() =>
                        removeBan.mutate({
                          name: ban.name ?? undefined,
                          uid: ban.uid ?? undefined,
                        })
                      }
                      size="sm"
                      variant="outline"
                    >
                      {t("players.unban")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">{t("players.bansHint")}</p>
          </CardContent>
        </Card>
      </div>
      </div>
    </ScrollArea>
  );
}
