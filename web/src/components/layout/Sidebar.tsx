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

import { StatusDot, statusMeta } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { useStatus } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: Gauge, exact: true },
  { to: "/console", label: "Console", icon: Terminal },
  { to: "/mods", label: "Mods", icon: Package },
  { to: "/config", label: "Mod Configs", icon: FileJson2 },
  { to: "/versions", label: "Versions", icon: Boxes },
  { to: "/settings", label: "Settings", icon: Settings },
];

const soonItems: { label: string; icon: LucideIcon }[] = [
  { label: "Players", icon: Users },
  { label: "Backups", icon: Archive },
];

export default function Sidebar() {
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
          <span className="truncate text-sm font-bold tracking-wide">VS WEBUI</span>
          <span className="truncate text-[10px] font-medium tracking-widest uppercase text-accent-amber">
            Server Manager
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <p className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-widest uppercase text-text-muted">
          Navigation
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
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="px-2 pt-4 pb-1 text-[10px] font-medium tracking-widest uppercase text-text-muted">
          Coming soon
        </p>
        <ul className="grid gap-0.5">
          {soonItems.map((item) => {
            const Icon = item.icon;
            return (
              <li
                className="flex cursor-default items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-text-muted opacity-70"
                key={item.label}
                title="Not available yet — planned"
              >
                <Icon className="size-4 shrink-0" />
                <span>{item.label}</span>
                <Badge className="ml-auto" variant="outline">
                  Soon
                </Badge>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className={cn("text-xs font-medium", meta.text)}>{meta.label}</span>
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
          {data?.status.version ?? data?.settings.version ?? "no version selected"}
        </p>
      </div>
    </aside>
  );
}
