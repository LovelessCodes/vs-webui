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
import { Check, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import ThemeToggle from "@/components/common/ThemeToggle";
import { StatusDot, statusMeta } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useStatus } from "@/hooks/use-api";
import { LANGUAGES, setLanguage } from "@/lib/i18n";
import { cn } from "cn";

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
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="pt-3">
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
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="grid gap-2 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2 px-1">
            <StatusDot status={status} />
            <span className={cn("text-xs font-medium", meta.text)}>{t(meta.labelKey)}</span>
            <div className="flex-1" />
            <ThemeToggle />
          </div>
          <p className="truncate px-1 font-mono text-[10px] text-muted-foreground">
            {data?.status.version ?? data?.settings.version ?? t("status.noVersion")}
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button className="w-full justify-start px-1" size="sm" variant="ghost" />}
            >
              <Languages />
              <span className="truncate">{t(`language.${i18n.language}`)}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
                {LANGUAGES.map((language) => (
                  <DropdownMenuItem key={language} onClick={() => setLanguage(language)}>
                    <span className="flex-1">{t(`language.${language}`)}</span>
                    {i18n.language === language && <Check />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </SidebarRoot>
  );
}
