import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBackups, useInstalledMods, useModUpdates, useStatus, useStorage } from "@/hooks/use-api";
import { formatBytes } from "@/lib/format";
import { findMissingDependencies } from "@/lib/version";

interface AttentionItem {
  key: string;
  severity: "error" | "warning" | "info";
  label: string;
  to?: "/console" | "/mods" | "/versions" | "/settings" | "/backups";
  /** External link (e.g. the manager release page). */
  href?: string;
}

const severityIcon = {
  error: { icon: ShieldAlert, className: "text-error" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  info: { icon: Info, className: "text-accent-primary" },
} as const;

/** Aggregates everything actionable across the manager into one card. */
export default function AttentionCard() {
  const { t } = useTranslation();
  const status = useStatus();
  const installed = useInstalledMods();
  const updates = useModUpdates();
  const backups = useBackups();
  const storage = useStorage();

  const data = status.data;
  const items: AttentionItem[] = [];

  if (data?.status.status === "crashed") {
    items.push({
      key: "crashed",
      severity: "error",
      label: t("dashboard.attentionCrashed"),
      to: "/console",
    });
  }

  // The running build differing from the selected one also needs a restart,
  // even if the persisted flag was missed.
  const runningBuild = data?.status.version ?? null;
  const settings = data?.settings;
  const selectedBuild = settings?.flavor === "stratum" ? settings.stratum_tag : settings?.version;
  const buildMismatch = Boolean(runningBuild && selectedBuild && runningBuild !== selectedBuild);
  const restartFlag = settings?.restart_required ?? false;
  if (data?.status.status === "running" && (restartFlag || buildMismatch)) {
    items.push({
      key: "restart",
      severity: "warning",
      label: t("dashboard.attentionRestart"),
      to: "/settings",
    });
  }

  if (data?.updates?.game) {
    items.push({
      key: "gameUpdate",
      severity: "info",
      label: t("dashboard.attentionGameUpdate", { version: data.updates.game }),
      to: "/versions",
    });
  }
  if (data?.updates?.stratum) {
    items.push({
      key: "stratumUpdate",
      severity: "info",
      label: t("dashboard.attentionStratumUpdate", { tag: data.updates.stratum }),
      to: "/versions",
    });
  }
  if (data?.updates?.manager) {
    items.push({
      key: "managerUpdate",
      severity: "info",
      label: t("dashboard.attentionManagerUpdate", { version: data.updates.manager }),
      href: "https://github.com/LovelessCodes/vs-webui/releases",
    });
  }

  const updateCount = Object.keys(updates.data?.updates ?? {}).length;
  if (updateCount > 0) {
    items.push({
      key: "modUpdates",
      severity: "info",
      label: t("dashboard.attentionModUpdates", { count: updateCount }),
      to: "/mods",
    });
  }

  const broken = installed.data?.errors.length ?? 0;
  if (broken > 0) {
    items.push({
      key: "brokenMods",
      severity: "warning",
      label: t("dashboard.attentionBrokenMods", { count: broken }),
      to: "/mods",
    });
  }

  const missing = findMissingDependencies(installed.data?.mods).length;
  if (missing > 0) {
    items.push({
      key: "missingDeps",
      severity: "warning",
      label: t("dashboard.attentionMissingDeps", { count: missing }),
      to: "/mods",
    });
  }

  const free = storage.data?.free_bytes;
  const total = storage.data?.total_bytes;
  if (free !== undefined && total !== undefined && total > 0 && free / total < 0.1) {
    items.push({
      key: "disk",
      severity: "warning",
      label: t("dashboard.attentionLowDisk", { size: formatBytes(free) }),
    });
  }

  const serverBackups = (backups.data?.backups ?? []).filter((entry) =>
    entry.name.startsWith("server"),
  );
  const newest = serverBackups[0];
  if (newest) {
    if (newest.modified < Date.now() / 1000 - 7 * 86400) {
      items.push({
        key: "staleBackup",
        severity: "warning",
        label: t("dashboard.attentionStaleBackup"),
        to: "/backups",
      });
    }
  } else if (data) {
    items.push({
      key: "noBackup",
      severity: "info",
      label: t("dashboard.attentionNoBackup"),
      to: "/backups",
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-muted-foreground" />
            {t("dashboard.attention")}
          </CardTitle>
          {items.length > 0 && (
            <span className="text-warning text-xs font-medium">{items.length}</span>
          )}
        </div>
        <CardDescription>{t("dashboard.attentionDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="size-4" />
            {t("dashboard.attentionAllGood")}
          </p>
        ) : (
          <ul className="grid gap-2 text-xs">
            {items.map((item) => {
              const { icon: Icon, className } = severityIcon[item.severity];
              const body = (
                <span className="flex items-start gap-2">
                  <Icon className={`mt-0.5 size-3.5 shrink-0 ${className}`} />
                  <span>{item.label}</span>
                </span>
              );
              return (
                <li key={item.key}>
                  {item.to ? (
                    <Link className="hover:underline underline-offset-4" to={item.to}>
                      {body}
                    </Link>
                  ) : item.href ? (
                    <a
                      className="hover:underline underline-offset-4"
                      href={item.href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {body}
                    </a>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
