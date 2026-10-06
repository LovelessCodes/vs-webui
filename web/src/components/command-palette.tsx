import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  Boxes,
  FileJson2,
  Gauge,
  Package,
  Play,
  RotateCw,
  Settings,
  Square,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  useServerRestart,
  useServerStart,
  useServerStop,
  useStatus,
} from "@/hooks/use-api";

const pages: { to: string; labelKey: string; icon: LucideIcon }[] = [
  { to: "/", labelKey: "nav.dashboard", icon: Gauge },
  { to: "/console", labelKey: "nav.console", icon: Terminal },
  { to: "/mods", labelKey: "nav.mods", icon: Package },
  { to: "/config", labelKey: "nav.configs", icon: FileJson2 },
  { to: "/players", labelKey: "nav.players", icon: Users },
  { to: "/backups", labelKey: "nav.backups", icon: Archive },
  { to: "/versions", labelKey: "nav.versions", icon: Boxes },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useStatus();
  const start = useServerStart();
  const stop = useServerStop();
  const restart = useServerRestart();

  const serverStatus = status.data?.status.status;
  const canStart = serverStatus === "stopped" || serverStatus === "crashed";
  const canStop = serverStatus === "running" || serverStatus === "starting";

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <CommandDialog onOpenChange={onOpenChange} open={open}>
      <CommandInput placeholder={t("command.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("command.empty")}</CommandEmpty>
        <CommandGroup heading={t("command.navigation")}>
          {pages.map((page) => {
            const Icon = page.icon;
            return (
              <CommandItem
                key={page.to}
                onSelect={() =>
                  run(() => void navigate({ to: page.to as "/" }))
                }
              >
                <Icon />
                <span>{t(page.labelKey)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandGroup heading={t("command.server")}>
          <CommandItem disabled={!canStart} onSelect={() => run(() => start.mutate())}>
            <Play />
            <span>{t("dashboard.start")}</span>
          </CommandItem>
          <CommandItem disabled={!canStop} onSelect={() => run(() => stop.mutate())}>
            <Square />
            <span>{t("dashboard.stop")}</span>
          </CommandItem>
          <CommandItem disabled={!canStop} onSelect={() => run(() => restart.mutate())}>
            <RotateCw />
            <span>{t("dashboard.restart")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-end border-t border-border px-3 py-2">
        <CommandShortcut>⌘K</CommandShortcut>
      </div>
    </CommandDialog>
  );
}
