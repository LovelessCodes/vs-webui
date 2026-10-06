import { useTranslation } from "react-i18next";

import Sparkline from "@/components/dashboard/Sparkline";
import type { MetricSample } from "@/lib/api";
import { formatBytes } from "@/lib/format";

/** CPU / memory / TPS tiles with hover tooltips; shared by the dashboard and
 * the guest view. */
export default function MetricTiles({ samples }: { samples: MetricSample[] }) {
  const { t } = useTranslation();
  const last = samples[samples.length - 1];
  const cpuPoints = samples.map((sample) => ({ ts: sample.ts, value: sample.cpu }));
  const memoryPoints = samples.map((sample) => ({
    ts: sample.ts,
    value: sample.memory / (1024 * 1024),
  }));
  const tpsPoints = samples
    .filter((sample): sample is MetricSample & { tps: number } => sample.tps !== null)
    .map((sample) => ({ ts: sample.ts, value: sample.tps }));

  if (samples.length < 2) {
    return <p className="text-muted-foreground text-xs">{t("dashboard.noMetrics")}</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="grid min-w-0 gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground text-[11px]">{t("dashboard.cpu")}</span>
          <span className="font-mono text-xs">{last ? `${last.cpu.toFixed(0)}%` : "—"}</span>
        </div>
        <Sparkline
          ariaLabel={t("dashboard.cpu")}
          color="#8b5cf6"
          formatValue={(value) => `${value.toFixed(0)}%`}
          points={cpuPoints}
          valueLabel={t("dashboard.cpu")}
        />
      </div>
      <div className="grid min-w-0 gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground text-[11px]">{t("dashboard.memory")}</span>
          <span className="font-mono text-xs">{last ? formatBytes(last.memory) : "—"}</span>
        </div>
        <Sparkline
          ariaLabel={t("dashboard.memory")}
          color="#2ea043"
          formatValue={(value) => formatBytes(value * 1024 * 1024)}
          points={memoryPoints}
          valueLabel={t("dashboard.memory")}
        />
      </div>
      <div className="grid min-w-0 gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground text-[11px]">{t("dashboard.tps")}</span>
          <span className="font-mono text-xs">
            {last?.tps !== null && last?.tps !== undefined ? last.tps.toFixed(1) : "—"}
          </span>
        </div>
        {tpsPoints.length >= 2 ? (
          <Sparkline
            ariaLabel={t("dashboard.tps")}
            color="#f59e0b"
            formatValue={(value) => value.toFixed(1)}
            points={tpsPoints}
            valueLabel={t("dashboard.tps")}
          />
        ) : (
          <p className="text-muted-foreground text-[10px]">{t("dashboard.tpsHint")}</p>
        )}
      </div>
    </div>
  );
}
