import { LogOut, MonitorSmartphone } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe, useRevokeOtherSessions, useRevokeSession, useSessions } from "@/hooks/use-api";
import { formatDuration } from "@/lib/format";

function shortAgent(agent: string) {
  if (!agent) return "—";
  return agent.length > 48 ? `${agent.slice(0, 48)}…` : agent;
}

/** Active sessions with per-session revoke; owners see everyone's. */
export default function SessionsCard() {
  const { t } = useTranslation();
  const me = useMe();
  const isOwner = me.data?.user?.role === "owner";
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const list = sessions.data?.sessions ?? [];
  const now = Math.floor(Date.now() / 1000);

  return (
    <Card className="self-start lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="size-4 text-muted-foreground" />
            {t("settings.sessionsTitle")}
          </CardTitle>
          <Button
            disabled={list.length <= 1 || revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
            size="sm"
            variant="outline"
          >
            <LogOut />
            {t("settings.sessionsRevokeOthers")}
          </Button>
        </div>
        <CardDescription>{t("settings.sessionsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {list.length === 0 && (
          <p className="text-muted-foreground text-xs">{t("settings.sessionsEmpty")}</p>
        )}

        {list.length > 0 && (
          <div className="border border-border">
            <div className="flex items-center gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              {isOwner && <span className="w-24">{t("settings.auditActor")}</span>}
              <span className="flex-1">{t("settings.sessionAgent")}</span>
              <span className="hidden w-32 sm:block">{t("settings.auditIp")}</span>
              <span className="hidden w-28 md:block">{t("settings.sessionLastSeen")}</span>
              <span className="w-24 text-right" />
            </div>
            <div className="divide-y divide-border">
              {list.map((session) => (
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5" key={session.id}>
                  {isOwner && (
                    <span className="w-24 truncate text-xs font-medium">{session.user}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {shortAgent(session.agent)}
                  </span>
                  <span className="hidden w-32 font-mono text-[11px] text-muted-foreground sm:block">
                    {session.ip || "—"}
                  </span>
                  <span
                    className="hidden w-28 font-mono text-[11px] text-muted-foreground md:block"
                    title={new Date(session.created * 1000).toLocaleString()}
                  >
                    {formatDuration(Math.max(0, now - session.last_seen))}
                  </span>
                  <div className="flex w-24 shrink-0 items-center justify-end gap-1.5">
                    {session.current ? (
                      <Badge variant="accent">{t("settings.sessionCurrent")}</Badge>
                    ) : (
                      <Button
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(session.id)}
                        size="sm"
                        variant="outline"
                      >
                        {t("settings.sessionRevoke")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
