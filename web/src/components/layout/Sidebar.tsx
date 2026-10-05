import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  Boxes,
  FileJson2,
  Gauge,
  Package,
  Settings,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { StatusDot, statusMeta } from "@/components/status-badge";
import { useStatus } from "@/hooks/use-api";
import { LANGUAGES, setLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  exact?: boolean;
}

const navItems: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: Gauge, exact: true },
  { to: "/console", labelKey: "nav.console", icon: Terminal },
  { to: "/mods", labelKey: "nav.mods", icon: Package },
  { to: "/config", labelKey: "nav.configs", icon: FileJson2 },
  { to: "/players", labelKey: "nav.players", icon: Users },
  { to: "/backups", labelKey: "nav.backups", icon: Archive },
  { to: "/versions", labelKey: "nav.versions", icon: Boxes },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data } = useStatus();
  const status = data?.status.status;
  const meta = statusMeta(status);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border-default bg-bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-4">
        <div className="flex size-8 shrink-0 items-center justify-center border border-accent-primary/40 bg-accent-primary/10">
          <span className="text-sm font-bold text-accent-primary">VS</span>
        </div>
        <div className="grid min-w-0 leading-tight">
          <span className="truncate text-sm font-bold tracking-wide">{t("brand.name")}</span>
          <span className="truncate text-[10px] font-medium tracking-widest uppercase text-accent-amber">
            {t("brand.tagline")}
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <p className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-widest uppercase text-text-muted">
          {t("nav.navigation")}
        </p>
        <ul className="grid gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <li key={item.to}>
                <Link
                  className={cn(
                    "flex items-center gap-2.5 border-l-2 border-transparent px-2.5 py-2 text-xs font-medium transition-colors",
                    active
                      ? "border-l-accent-primary bg-bg-card text-text-primary"
                      : "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary",
                  )}
                  to={item.to}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="grid gap-2 border-t border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className={cn("text-xs font-medium", meta.text)}>{t(meta.labelKey)}</span>
        </div>
        <p className="truncate font-mono text-[10px] text-text-muted">
          {data?.status.version ?? data?.settings.version ?? t("status.noVersion")}
        </p>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("language.label")}</span>
          <select
            className="h-7 w-full border border-border-default bg-bg-input px-2 text-[11px] text-text-secondary focus:outline-none"
            onChange={(event) => setLanguage(event.target.value)}
            value={i18n.language}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(`language.${language}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </aside>
  );
}
