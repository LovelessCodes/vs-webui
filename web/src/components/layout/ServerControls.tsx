import { Play, RotateCw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { StatusDot, statusMeta } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerRestart, useServerStart, useServerStop, useStatus } from "@/hooks/use-api";
import { cn } from "cn";

/** Status indicator plus quick start/stop/restart actions for the header. */
export default function ServerControls() {
  const { t } = useTranslation();
  const { data } = useStatus();
  const start = useServerStart();
  const stop = useServerStop();
  const restart = useServerRestart();

  const status = data?.status.status;
  const meta = statusMeta(status);
  const busy = start.isPending || stop.isPending || restart.isPending;
  const canStart =
    (status === "stopped" || status === "crashed") && Boolean(data?.settings.version);
  const canStop = status === "running" || status === "starting";
  const version = data?.status.version ?? data?.settings.version ?? undefined;

  return (
    <div className="flex items-center gap-1.5">
      <span className="flex items-center gap-1.5 px-1" title={version}>
        <StatusDot status={status} />
        <span className={cn("text-xs font-medium", meta.text)}>{t(meta.labelKey)}</span>
      </span>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={t("dashboard.start")}
              disabled={!canStart || busy}
              onClick={() => start.mutate()}
              size="icon-sm"
              variant="outline-success"
            />
          }
        >
          <Play />
        </TooltipTrigger>
        <TooltipContent>{t("dashboard.start")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={t("dashboard.stop")}
              disabled={!canStop || busy}
              onClick={() => stop.mutate()}
              size="icon-sm"
              variant="outline"
            />
          }
        >
          <Square />
        </TooltipTrigger>
        <TooltipContent>{t("dashboard.stop")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={t("dashboard.restart")}
              disabled={!canStop || busy}
              onClick={() => restart.mutate()}
              size="icon-sm"
              variant="outline"
            />
          }
        >
          <RotateCw className={restart.isPending ? "animate-spin" : undefined} />
        </TooltipTrigger>
        <TooltipContent>{t("dashboard.restart")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
