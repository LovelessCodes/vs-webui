import {
  Archive,
  CalendarClock,
  Loader2,
  Pencil,
  Plus,
  Save,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-api";
import { api } from "@/lib/api";
import type { ScheduledTask } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { toast } from "@/lib/notify";

type TaskKind = "restart" | "backup" | "command";

const WEEKDAY_NAMES = Array.from({ length: 7 }, (_, index) =>
  new Date(Date.UTC(2026, 0, 5 + index)).toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  }),
);

const TIMEZONE_SUGGESTIONS = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Australia/Sydney",
];

function randomId() {
  return `task-${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
}

function kindIcon(kind: TaskKind) {
  if (kind === "backup") return <Archive className="size-3.5" />;
  if (kind === "command") return <Terminal className="size-3.5" />;
  return <CalendarClock className="size-3.5" />;
}

/** Cron-like scheduled restarts, backups and console commands. */
export default function ScheduleCard() {
  const { t } = useTranslation();
  const settings = useSettings();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [timezone, setTimezone] = useState("");
  const [editing, setEditing] = useState<{ task: ScheduledTask; index: number | null } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (settings.data) {
      setTasks(settings.data.tasks ?? []);
      setTimezone(settings.data.timezone ?? "");
    }
  }, [settings.data]);

  async function save(nextTasks: ScheduledTask[], nextTimezone: string) {
    setSaving(true);
    setError(null);
    try {
      await api.saveSettings({ tasks: nextTasks, timezone: nextTimezone });
      toast.success(t("common.saved"));
      await settings.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError : new Error(String(saveError)));
    } finally {
      setSaving(false);
    }
  }

  function upsert(task: ScheduledTask, index: number | null) {
    setTasks((current) => {
      const next = [...current];
      if (index === null) next.push(task);
      else next[index] = task;
      return next;
    });
    setEditing(null);
  }

  return (
    <Card className="self-start lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" />
            {t("settings.scheduleTitle")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setEditing({ task: emptyTask(), index: null })}
              size="sm"
              variant="outline"
            >
              <Plus />
              {t("settings.taskAdd")}
            </Button>
            <Button
              disabled={saving}
              onClick={() => void save(tasks, timezone)}
              size="sm"
              variant="accent-primary"
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {t("common.save")}
            </Button>
          </div>
        </div>
        <CardDescription>{t("settings.scheduleDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-timezone">{t("settings.timezone")}</Label>
          <div className="flex items-center gap-2">
            <Input
              className="max-w-64"
              id="schedule-timezone"
              list="timezone-suggestions"
              onChange={(event) => setTimezone(event.target.value)}
              placeholder={t("settings.timezonePlaceholder")}
              value={timezone}
            />
            <datalist id="timezone-suggestions">
              {TIMEZONE_SUGGESTIONS.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("settings.timezoneHint")}</p>
        </div>

        {tasks.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("settings.tasksEmpty")}</p>
        )}

        {tasks.length > 0 && (
          <div className="border border-border">
            <div className="divide-y divide-border">
              {tasks.map((task, index) => (
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5" key={task.id}>
                  <Switch
                    checked={task.enabled}
                    onCheckedChange={(enabled) =>
                      setTasks((current) =>
                        current.map((entry, position) =>
                          position === index ? { ...entry, enabled } : entry,
                        ),
                      )
                    }
                  />
                  <span className="flex w-24 items-center gap-1.5 text-xs font-medium">
                    {kindIcon(task.kind)}
                    {t(`settings.taskKind.${task.kind}`)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {task.times.map((time) => (
                      <Badge key={time} variant="outline">
                        {time}
                      </Badge>
                    ))}
                    {task.date ? (
                      <Badge variant="amber">
                        {t("settings.taskOnce", { date: task.date })}
                      </Badge>
                    ) : (task.weekdays ?? []).length > 0 ? (
                      <span className="text-[11px] text-muted-foreground">
                        {(task.weekdays ?? []).map((day) => WEEKDAY_NAMES[day - 1]).join(", ")}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {t("settings.taskEveryDay")}
                      </span>
                    )}
                    {task.backup_before && (
                      <Badge variant="info">{t("settings.taskBackupFirst")}</Badge>
                    )}
                    {task.command && (
                      <code className="truncate font-mono text-[11px] text-muted-foreground">
                        {task.command}
                      </code>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      onClick={() => setEditing({ task: { ...task }, index })}
                      size="icon-sm"
                      title={t("settings.taskEdit")}
                      variant="ghost"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      onClick={() =>
                        setTasks((current) => current.filter((_, position) => position !== index))
                      }
                      size="icon-sm"
                      title={t("common.remove")}
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-error text-xs">{errorMessage(error)}</p>}
      </CardContent>

      <TaskSheet
        draft={editing}
        onClose={() => setEditing(null)}
        onSave={(task) => upsert(task, editing?.index ?? null)}
      />
    </Card>
  );
}

function emptyTask(): ScheduledTask {
  return {
    id: randomId(),
    enabled: true,
    kind: "restart",
    command: "",
    times: ["04:30"],
    weekdays: [],
    backup_before: false,
    date: null,
  };
}

/** Editor sheet for one scheduled task. */
function TaskSheet({
  draft,
  onClose,
  onSave,
}: {
  draft: { task: ScheduledTask; index: number | null } | null;
  onClose: () => void;
  onSave: (task: ScheduledTask) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<TaskKind>("restart");
  const [command, setCommand] = useState("");
  const [times, setTimes] = useState<string[]>(["04:30"]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [backupBefore, setBackupBefore] = useState(false);
  const [runOnce, setRunOnce] = useState(false);
  const [date, setDate] = useState("");

  useEffect(() => {
    if (!draft) return;
    const task = draft.task;
    setKind(task.kind);
    setCommand(task.command ?? "");
    setTimes(task.times?.length ? task.times : ["04:30"]);
    setWeekdays(task.weekdays ?? []);
    setBackupBefore(task.backup_before);
    setRunOnce(Boolean(task.date));
    setDate(task.date ?? "");
  }, [draft]);

  const open = Boolean(draft);
  const canSave =
    times.length > 0 &&
    times.every((time) => /^\d{2}:\d{2}$/.test(time)) &&
    (kind !== "command" || command.trim().length > 0) &&
    (!runOnce || /^\d{4}-\d{2}-\d{2}$/.test(date));

  function submit() {
    if (!draft || !canSave) return;
    onSave({
      ...draft.task,
      kind,
      command: kind === "command" ? command.trim() : null,
      times: runOnce ? [times[0]] : times,
      weekdays: runOnce ? [] : weekdays,
      backup_before: kind === "restart" ? backupBefore : false,
      date: runOnce ? date : null,
    });
  }

  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md" side="right">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" />
            {draft?.index === null ? t("settings.taskAdd") : t("settings.taskEdit")}
          </SheetTitle>
          <SheetDescription>{t("settings.taskDescription")}</SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 overflow-y-auto p-4">
          <div className="grid gap-1.5">
            <Label>{t("settings.taskKindLabel")}</Label>
            <Select
              items={[
                { value: "restart", label: t("settings.taskKind.restart") },
                { value: "backup", label: t("settings.taskKind.backup") },
                { value: "command", label: t("settings.taskKind.command") },
              ]}
              onValueChange={(value) => {
                if (value === "restart" || value === "backup" || value === "command") {
                  setKind(value);
                }
              }}
              value={kind}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="restart">{t("settings.taskKind.restart")}</SelectItem>
                <SelectItem value="backup">{t("settings.taskKind.backup")}</SelectItem>
                <SelectItem value="command">{t("settings.taskKind.command")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "command" && (
            <div className="grid gap-1.5">
              <Label htmlFor="task-command">{t("settings.taskCommand")}</Label>
              <Input
                id="task-command"
                onChange={(event) => setCommand(event.target.value)}
                placeholder="/announce Server restart soon"
                value={command}
              />
              <p className="text-[11px] text-muted-foreground">{t("settings.taskCommandHint")}</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="task-once">{t("settings.taskRunOnce")}</Label>
              <p className="text-[11px] text-muted-foreground">{t("settings.taskRunOnceHint")}</p>
            </div>
            <Switch checked={runOnce} id="task-once" onCheckedChange={setRunOnce} />
          </div>

          {runOnce && (
            <div className="grid gap-1.5">
              <Label htmlFor="task-date">{t("settings.taskDate")}</Label>
              <Input
                id="task-date"
                onChange={(event) => setDate(event.target.value)}
                type="date"
                value={date}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>{t("settings.taskTimes")}</Label>
            <div className="grid gap-2">
              {(runOnce ? times.slice(0, 1) : times).map((time, index) => (
                <div className="flex items-center gap-2" key={`${index}-${time}`}>
                  <Input
                    className="w-32"
                    onChange={(event) =>
                      setTimes((current) =>
                        current.map((entry, position) =>
                          position === index ? event.target.value : entry,
                        ),
                      )
                    }
                    type="time"
                    value={time}
                  />
                  {!runOnce && times.length > 1 && (
                    <Button
                      onClick={() =>
                        setTimes((current) => current.filter((_, position) => position !== index))
                      }
                      size="icon-sm"
                      title={t("common.remove")}
                      variant="ghost"
                    >
                      <X />
                    </Button>
                  )}
                </div>
              ))}
              {!runOnce && times.length < 24 && (
                <Button
                  className="w-fit"
                  onClick={() => setTimes((current) => [...current, "12:00"])}
                  size="sm"
                  variant="outline"
                >
                  <Plus />
                  {t("settings.taskAddTime")}
                </Button>
              )}
            </div>
          </div>

          {!runOnce && (
            <div className="grid gap-1.5">
              <Label>{t("settings.taskWeekdays")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_NAMES.map((name, index) => {
                  const day = index + 1;
                  const active = weekdays.includes(day);
                  return (
                    <Button
                      key={name}
                      onClick={() =>
                        setWeekdays((current) =>
                          active
                            ? current.filter((entry) => entry !== day)
                            : [...current, day].sort((a, b) => a - b),
                        )
                      }
                      size="sm"
                      variant={active ? "accent-primary" : "outline"}
                    >
                      {name}
                    </Button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("settings.taskWeekdaysHint")}</p>
            </div>
          )}

          {kind === "restart" && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="task-backup-before">{t("settings.taskBackupFirst")}</Label>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.taskBackupFirstHint")}
                </p>
              </div>
              <Switch
                checked={backupBefore}
                id="task-backup-before"
                onCheckedChange={setBackupBefore}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button disabled={!canSave} onClick={submit} variant="accent-primary">
              <Save />
              {t("common.save")}
            </Button>
            <Button onClick={onClose} variant="ghost">
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
