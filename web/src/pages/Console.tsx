import { Eraser, Loader2, Play, Send, Square, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import VirtualList from "@/components/common/VirtualList";
import { StatusDot } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerCommand, useServerStart, useServerStop, useStatus } from "@/hooks/use-api";
import { consoleStream, type ConsoleLine } from "@/lib/api";
import { errorMessage } from "@/lib/format";

const MAX_LINES = 2000;

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
  return "text-text-secondary";
}

export default function Console() {
  const { t } = useTranslation();
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const status = useStatus();
  const start = useServerStart();
  const stop = useServerStop();
  const send = useServerCommand();
  const serverStatus = status.data?.status.status;
  const canStart = serverStatus === "stopped" || serverStatus === "crashed";
  const canStop = serverStatus === "running" || serverStatus === "starting";

  useEffect(() => {
    let cancelled = false;

    fetch("/api/console/history?limit=500", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((data: { lines?: ConsoleLine[] }) => {
        if (!cancelled && data.lines) setLines(data.lines);
      })
      .catch(() => {});

    const source = consoleStream();
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
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
      cancelled = true;
      source.close();
    };
  }, []);

  function submit() {
    const command = input.trim();
    if (!command || !canStop) return;
    send.mutate(command);
    setHistory((previous) => [command, ...previous].slice(0, 100));
    setHistoryIndex(-1);
    setInput("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
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
          <span className="text-text-secondary">
            {connected ? (
              <span className="flex items-center gap-1.5">
                <Wifi className="size-3.5 text-success" /> {t("console.live")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <WifiOff className="size-3.5 text-text-muted" /> {t("console.reconnecting")}
              </span>
            )}
          </span>
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            checked={follow}
            className="accent-[#8b5cf6]"
            onChange={(event) => setFollow(event.target.checked)}
            type="checkbox"
          />
          {t("console.follow")}
        </label>
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

      <div className="flex min-h-0 flex-1 flex-col border border-border-default bg-bg-input">
        <VirtualList
          empty={<p className="px-3 py-2 text-text-muted">{t("console.empty")}</p>}
          estimateRowHeight={18}
          items={lines}
          keyOf={(line, index) => `${line.ts}-${index}`}
          onStickChange={setFollow}
          renderItem={(line) => (
            <div className="px-3 py-0.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              <span className="text-text-muted">{line.ts}</span>{" "}
              <span className={lineClass(line.line)}>{line.line}</span>
            </div>
          )}
          stickToBottom={follow}
        />
      </div>

      <div className="flex items-center gap-2">
        <Input
          disabled={!canStop}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            canStop ? t("console.placeholderRunning") : t("console.placeholderStopped")
          }
          value={input}
        />
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
    </div>
  );
}
