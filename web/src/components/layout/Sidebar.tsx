import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  Boxes,
  Earth,
  FileJson2,
  Gauge,
  MessageSquare,
  Package,
  Settings,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useModUpdates, useStatus } from "@/hooks/use-api";

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  exact?: boolean;
}

const navItems: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: Gauge, exact: true },
  { to: "/console", labelKey: "nav.console", icon: Terminal },
  { to: "/chat", labelKey: "nav.chat", icon: MessageSquare },
  { to: "/mods", labelKey: "nav.mods", icon: Package },
  { to: "/config", labelKey: "nav.configs", icon: FileJson2 },
  { to: "/players", labelKey: "nav.players", icon: Users },
  { to: "/backups", labelKey: "nav.backups", icon: Archive },
  { to: "/worlds", labelKey: "nav.worlds", icon: Earth },
  { to: "/versions", labelKey: "nav.versions", icon: Boxes },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data } = useStatus();
  const modUpdates = useModUpdates();
  const updateCount = Object.keys(modUpdates.data?.updates ?? {}).length;
  const hasVersionUpdate = Boolean(data?.updates?.game || data?.updates?.stratum);

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="pt-14">
        <div className="pointer-events-none flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:px-0">
          <div className="flex size-8 shrink-0 items-center justify-center border border-accent-primary/40 bg-accent-primary/10">
            <span className="text-sm font-bold text-accent-primary">VS</span>
          </div>
          <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-bold tracking-wide">{t("brand.name")}</span>
            <span className="truncate text-[10px] font-medium tracking-widest text-accent-amber uppercase">
              {t("brand.tagline")}
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.navigation")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = item.exact
                  ? pathname === item.to
                  : pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={active}
                      render={<Link to={item.to} />}
                      tooltip={t(item.labelKey)}
                    >
                      <Icon />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                    {item.to === "/mods" && updateCount > 0 && (
                      <SidebarMenuBadge>{updateCount}</SidebarMenuBadge>
                    )}
                    {item.to === "/versions" && hasVersionUpdate && (
                      <SidebarMenuBadge className="text-accent-amber">!</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <p className="truncate px-1 font-mono text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          {data?.status.version ?? data?.settings.version ?? t("status.noVersion")}
        </p>
      </SidebarFooter>

      <SidebarRail />
    </SidebarRoot>
  );
}
