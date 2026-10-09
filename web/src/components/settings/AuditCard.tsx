import { Loader2, RefreshCw, ScrollText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAudit } from "@/hooks/use-api";
import type { AuditEntry } from "@/lib/api";
import { cn } from "cn";

const MAX_ROWS = 200;

function statusClass(status: number) {
  if (status < 300) return "text-success";
  if (status < 500) return "text-warning";
  return "text-error";
}

function matches(entry: AuditEntry, filter: string) {
  if (!filter) return true;
  const haystack = [entry.actor, entry.role, entry.method, entry.path, entry.action, entry.ip, String(entry.status)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(filter.toLowerCase());
}

/** Recent mutating actions with actor, method, status and origin. */
export default function AuditCard() {
  const { t } = useTranslation();
  const audit = useAudit();
  const [filter, setFilter] = useState("");

  const entries = (audit.data?.entries ?? []).filter((entry) => matches(entry, filter));
  const shown = entries.slice(0, MAX_ROWS);

  return (
    <Card className="self-start lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-4 text-muted-foreground" />
            {t("settings.auditTitle")}
          </CardTitle>
          <Button
            disabled={audit.isFetching}
            onClick={() => void audit.refetch()}
            size="sm"
            variant="outline"
          >
            {audit.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("common.refresh")}
          </Button>
        </div>
        <CardDescription>{t("settings.auditDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Input
          className="max-w-sm"
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("settings.auditFilterPlaceholder")}
          value={filter}
        />

        {audit.isError && (
          <p className="text-error text-xs">{t("settings.auditUnavailable")}</p>
        )}

        {shown.length === 0 && !audit.isLoading && (
          <p className="text-muted-foreground text-xs">{t("settings.auditEmpty")}</p>
        )}

        {shown.length > 0 && (
          <div className="max-h-96 overflow-y-auto border border-border">
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              <span className="hidden w-40 sm:block">{t("settings.auditTime")}</span>
              <span className="w-28">{t("settings.auditActor")}</span>
              <span className="flex-1">{t("settings.auditRequest")}</span>
              <span className="w-14 text-right">{t("settings.auditStatus")}</span>
              <span className="hidden w-28 text-right md:block">{t("settings.auditIp")}</span>
            </div>
            <div className="divide-y divide-border">
              {shown.map((entry, index) => (
                <div
                  className="flex items-center gap-3 px-3 py-2"
                  key={`${entry.ts}-${entry.path}-${index}`}
                >
                  <span className="hidden w-40 font-mono text-[11px] text-muted-foreground sm:block">
                    {new Date(entry.ts * 1000).toLocaleString()}
                  </span>
                  <span className="flex w-28 items-center gap-1.5 truncate text-xs">
                    <span className="truncate font-medium">{entry.actor}</span>
                    {entry.kind === "token" && (
                      <Badge className="h-4 px-1 text-[9px]" variant="outline">
                        {t("settings.auditToken")}
                      </Badge>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    <span className="text-muted-foreground">{entry.method}</span> {entry.path}
                    {entry.action && (
                      <span className="text-muted-foreground"> · {entry.action}</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "w-14 text-right font-mono text-[11px]",
                      statusClass(entry.status),
                    )}
                  >
                    {entry.status}
                  </span>
                  <span className="hidden w-28 truncate text-right font-mono text-[11px] text-muted-foreground md:block">
                    {entry.ip}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {entries.length > MAX_ROWS && (
          <p className="text-[11px] text-muted-foreground">
            {t("settings.auditTruncated", { max: MAX_ROWS })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
