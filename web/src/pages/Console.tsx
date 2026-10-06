import {
  Download,
  Eraser,
  FileText,
  Loader2,
  Play,
  Search,
  Send,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import VirtualList from "@/components/common/VirtualList";
import { StatusDot } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useLogFiles,
  useServerCommand,
  useServerStart,
  useServerStop,
  useStatus,
} from "@/hooks/use-api";
import { api, consoleStream, type ConsoleLine, type LogFileEntry } from "@/lib/api";
import { errorMessage, formatBytes } from "@/lib/format";
import { cn } from "cn";

const MAX_LINES = 2000;
const HISTORY_KEY = "vs-webui-console-history";

/** Suggested commands; trailing space marks ones that take an argument. */
const COMMANDS = [
  "/announce ",
  "/ban ",
  "/deop ",
  "/help",
  "/kick ",
  "/op ",
  "/stats",
  "/stop",
  "/stratum reload",
  "/time ",
  "/tp ",
  "/unban ",
  "/weather ",
  "/whitelist ",
];

function lineClass(line: string): string {
  if (line.includes("[Error]") || line.includes(" ERROR") || line.startsWith("ERROR")) {
    return "text-error";
  }
  if (line.includes("[Warning]") || line.includes(" WARN") || line.startsWith("WARN")) {
    return "text-warning";
  }
  if (line.startsWith("[manager]") || line.startsWith("»")) {
    return "text-info";
  }
  return "text-muted-foreground";
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m|\u001b\[[0-9;]*[A-Za-z]/g;

const SGR_CLASSES: Record<number, string> = {
  30: "text-muted-foreground",
  31: "text-error",
  32: "text-success",
  33: "text-warning",
  34: "text-info",
  35: "text-accent-primary",
  36: "text-info",
  37: "text-foreground",
  39: "text-foreground",
  90: "text-muted-foreground",
  91: "text-error",
  92: "text-success",
  93: "text-warning",
  94: "text-info",
  95: "text-accent-primary",
  96: "text-info",
  97: "text-foreground",
};

/** Render a line with ANSI SGR colors (other escape sequences are stripped). */
function renderAnsi(text: string): ReactNode {
  if (!text.includes("\u001b")) return text;
  const parts: ReactNode[] = [];
  let bold = false;
  let color = "";
  let last = 0;
  let key = 0;

  const push = (chunk: string) => {
    if (!chunk) return;
    parts.push(
      <span className={cn(bold && "font-semibold", color) || undefined} key={key++}>
        {chunk}
      </span>,
    );
  };

  for (const match of text.matchAll(ANSI_PATTERN)) {
    push(text.slice(last, match.index));
    const sequence = match[0];
    if (sequence.endsWith("m")) {
      const codes = sequence
        .slice(2, -1)
        .split(";")
        .filter(Boolean)
        .map(Number);
      for (const code of codes) {
        if (code === 0) {
          bold = false;
          color = "";
        } else if (code === 1) {
          bold = true;
        } else if (code === 22) {
          bold = false;
        } else if (SGR_CLASSES[code]) {
          color = SGR_CLASSES[code];
        }
      }
    }
    last = match.index + sequence.length;
  }
  push(text.slice(last));
  return <>{parts}</>;
}

export default function Console() {
  const { t } = useTranslation();
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
      return Array.isArray(stored) ? (stored as string[]) : [];
    } catch {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const [filesOpen, setFilesOpen] = useState(false);
  const [viewing, setViewing] = useState<{ name: string; truncated: boolean } | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const modeRef = useRef<"live" | "file">("live");

  const status = useStatus();
  const logs = useLogFiles(filesOpen);
  const start = useServerStart();
  const stop = useServerStop();
  const send = useServerCommand();
  const serverStatus = status.data?.status.status;
  const canStart = serverStatus === "stopped" || serverStatus === "crashed";
  const canStop = serverStatus === "running" || serverStatus === "starting";

  async function loadHistory() {
    try {
      const data = await api.consoleHistory(500);
      if (modeRef.current === "live" && data.lines) setLines(data.lines);
    } catch {
      // ignore; the stream will fill the view
    }
  }

  useEffect(() => {
    void loadHistory();

    const source = consoleStream();
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      if (modeRef.current === "file") return;
      try {
        const line = JSON.parse(event.data) as ConsoleLine;
        setLines((previous) => {
          const next = [...previous, line];
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      } catch {
        // ignore malformed events
      }
    };

    return () => {
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
  }, [history]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? lines.filter((entry) => entry.line.toLowerCase().includes(q)) : lines),
    [lines, q],
  );

  const suggestions = useMemo(() => {
    if (!input.startsWith("/")) return [];
    return COMMANDS.filter((command) => command.startsWith(input) && command !== input).slice(0, 6);
  }, [input]);

  async function openFile(file: LogFileEntry) {
    try {
      const data = await api.logTail(file.name, 2000);
      modeRef.current = "file";
      setViewing({ name: data.name, truncated: data.truncated });
      setLines(data.content.length > 0 ? data.content.split("\n").map((line) => ({ ts: "", line })) : []);
      setFollow(false);
      setFilesOpen(false);
    } catch {
      // keep the live view on failure
    }
  }

  function backToLive() {
    modeRef.current = "live";
    setViewing(null);
    setFollow(true);
    void loadHistory();
  }

  function exportLog() {
    const text = lines
      .map((entry) => (entry.ts ? `${entry.ts} ${entry.line}` : entry.line))
      .join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = viewing
      ? viewing.name
      : `console-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function submit() {
    const command = input.trim();
    if (!command || !canStop) return;
    send.mutate(command);
    setHistory((previous) => [command, ...previous.filter((entry) => entry !== command)].slice(0, 100));
    setHistoryIndex(-1);
    setInput("");
    setSuggestionsOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Tab" && suggestions.length > 0) {
      event.preventDefault();
      setInput(suggestions[0]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      if (next >= 0) {
        setHistoryIndex(next);
        setInput(history[next]);
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = historyIndex - 1;
      if (next >= 0) {
        setHistoryIndex(next);
        setInput(history[next]);
      } else {
        setHistoryIndex(-1);
        setInput("");
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-xs">
          <StatusDot status={serverStatus} />
          <span className="text-muted-foreground">
            {connected ? (
              <span className="flex items-center gap-1.5">
                <Wifi className="size-3.5 text-success" /> {t("console.live")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <WifiOff className="size-3.5 text-muted-foreground" /> {t("console.reconnecting")}
              </span>
            )}
          </span>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-52 pl-7"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("console.filterPlaceholder")}
            value={query}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            checked={follow}
            className="accent-[#8b5cf6]"
            onChange={(event) => setFollow(event.target.checked)}
            type="checkbox"
          />
          {t("console.follow")}
        </label>
        <Button onClick={() => setFilesOpen(true)} size="sm" variant="outline">
          <FileText />
          {t("console.logFiles")}
        </Button>
        <Button disabled={lines.length === 0} onClick={exportLog} size="sm" variant="outline">
          <Download />
          {t("console.export")}
        </Button>
        <Button
          disabled={lines.length === 0}
          onClick={() => setLines([])}
          size="sm"
          variant="ghost"
        >
          <Eraser />
          {t("common.clear")}
        </Button>
        {canStart ? (
          <Button
            disabled={start.isPending}
            onClick={() => start.mutate()}
            size="sm"
            variant="success"
          >
            {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            {t("dashboard.start")}
          </Button>
        ) : (
          <Button
            disabled={!canStop || stop.isPending}
            onClick={() => stop.mutate()}
            size="sm"
            variant="outline"
          >
            {stop.isPending ? <Loader2 className="animate-spin" /> : <Square />}
            {t("dashboard.stop")}
          </Button>
        )}
      </div>

      {viewing && (
        <div className="flex flex-wrap items-center gap-2 border border-info/40 bg-info/5 px-3 py-2 text-xs">
          <FileText className="size-3.5 text-info" />
          <span className="font-medium">{t("console.viewingFile", { name: viewing.name })}</span>
          {viewing.truncated && (
            <span className="text-muted-foreground">· {t("console.truncated")}</span>
          )}
          <div className="flex-1" />
          <Button onClick={backToLive} size="sm" variant="outline">
            {t("console.backToLive")}
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col border border-border bg-input/30">
        <VirtualList
          empty={
            <p className="px-3 py-2 text-muted-foreground">
              {q ? t("console.noMatches") : t("console.empty")}
            </p>
          }
          estimateRowHeight={18}
          items={visible}
          keyOf={(line, index) => `${line.ts}-${index}`}
          onStickChange={setFollow}
          renderItem={(line) => (
            <div className="px-3 py-0.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {line.ts && <span className="text-muted-foreground">{line.ts} </span>}
              <span className={lineClass(line.line)}>{renderAnsi(line.line)}</span>
            </div>
          )}
          stickToBottom={follow && !q}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            disabled={!canStop}
            onChange={(event) => setInput(event.target.value)}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => setSuggestionsOpen(false)}
            onKeyDown={onKeyDown}
            placeholder={
              canStop ? t("console.placeholderRunning") : t("console.placeholderStopped")
            }
            value={input}
          />
          {suggestionsOpen && suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 z-20 mb-1 w-full border border-border bg-popover shadow-md">
              {suggestions.map((command) => (
                <button
                  className="block w-full px-2 py-1 text-left font-mono text-[11px] hover:bg-muted"
                  key={command}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setInput(command);
                  }}
                  type="button"
                >
                  {command}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          disabled={!canStop || input.trim().length === 0 || send.isPending}
          onClick={submit}
          variant="accent-primary"
        >
          <Send />
          {t("console.send")}
        </Button>
      </div>
      {send.isError && (
        <p className="text-error text-xs">
          {t("console.commandFailed", { message: errorMessage(send.error) })}
        </p>
      )}

      <Sheet onOpenChange={setFilesOpen} open={filesOpen}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md" side="right">
          <SheetHeader className="border-b border-border">
            <SheetTitle>{t("console.logFiles")}</SheetTitle>
            <SheetDescription>{t("console.logFilesDescription")}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {logs.isLoading && !logs.data && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("common.loading")}
              </div>
            )}
            {logs.data && logs.data.files.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("console.noLogs")}</p>
            )}
            {logs.data?.files.map((file) => (
              <div className="flex items-center gap-2 border-b border-border py-2" key={file.name}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px]">{file.name}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {formatBytes(file.size)} · {new Date(file.modified * 1000).toLocaleString()}
                  </p>
                </div>
                <Button onClick={() => void openFile(file)} size="sm" variant="outline">
                  {t("console.open")}
                </Button>
                <a
                  className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                  href={`/api/logs/${encodeURIComponent(file.name)}/download`}
                  title={t("common.download")}
                >
                  <Download />
                </a>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
