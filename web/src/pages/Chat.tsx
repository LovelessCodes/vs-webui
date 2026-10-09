import { LogIn, LogOut, Megaphone, MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useChat, useServerCommand, useStatus } from "@/hooks/use-api";
import type { ChatEntry } from "@/lib/api";

/** Stable per-player color from the name. */
function nameColor(name: string) {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return `hsl(${hash} 65% 62%)`;
}

function Row({ entry }: { entry: ChatEntry }) {
  if (entry.kind === "join" || entry.kind === "leave") {
    const Icon = entry.kind === "join" ? LogIn : LogOut;
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-[11px] text-muted-foreground">
        <Icon className="size-3" />
        <span>{entry.player}</span>
      </div>
    );
  }
  if (entry.kind === "announce") {
    return (
      <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
        <Megaphone className="mt-0.5 size-3.5 shrink-0 text-accent-amber" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap text-accent-amber">{entry.text}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {new Date(entry.ts * 1000).toLocaleTimeString()}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
      <span
        className="shrink-0 font-medium"
        style={entry.player ? { color: nameColor(entry.player) } : undefined}
      >
        {entry.player}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{entry.text}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {new Date(entry.ts * 1000).toLocaleTimeString()}
      </span>
    </div>
  );
}

/** In-game chat, joins/leaves and announcements, with a broadcast composer. */
export default function Chat() {
  const { t } = useTranslation();
  const chat = useChat(null);
  const status = useStatus();
  const command = useServerCommand();
  const [message, setMessage] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const entries = chat.data?.entries ?? [];
  const running = status.data?.status.status === "running";

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [entries.length]);

  function send() {
    const text = message.trim();
    if (!text) return;
    command.mutate(`/announce ${text}`, { onSuccess: () => setMessage("") });
  }

  return (
    <div className="flex h-full flex-col gap-3 pb-4 pr-1">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            {t("chat.title")}
          </CardTitle>
          <CardDescription>{t("chat.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
          <div
            className="min-h-0 flex-1 overflow-y-auto border-y border-border"
            onScroll={(event) => {
              const list = event.currentTarget;
              stickToBottom.current =
                list.scrollHeight - list.scrollTop - list.clientHeight < 40;
            }}
            ref={listRef}
          >
            {entries.length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">{t("chat.empty")}</p>
            )}
            <div className="divide-y divide-border/50">
              {entries.map((entry) => (
                <Row entry={entry} key={entry.id} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 px-4 pb-4">
            <Input
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") send();
              }}
              placeholder={
                running ? t("chat.composerPlaceholder") : t("chat.composerStopped")
              }
              value={message}
            />
            <Button
              disabled={!running || !message.trim() || command.isPending}
              onClick={send}
              variant="accent-primary"
            >
              <Send />
              {t("chat.send")}
            </Button>
          </div>
          <p className="px-4 pb-4 text-[11px] text-muted-foreground">{t("chat.composerHint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
