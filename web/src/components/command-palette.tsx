import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  Boxes,
  CloudDownload,
  FileJson2,
  FileText,
  Gauge,
  Package,
  PackagePlus,
  Play,
  RotateCw,
  Settings,
  Square,
  Terminal,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDownloadsSheet } from "@/components/downloads/downloads-sheet";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  useCreateBackup,
  useServerCommand,
  useServerRestart,
  useServerStart,
  useServerStop,
  useStatus,
  useUpdateAllMods,
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
  const createBackup = useCreateBackup();
  const updateAllMods = useUpdateAllMods();
  const command = useServerCommand();
  const downloads = useDownloadsSheet();

  const serverStatus = status.data?.status.status;
  const canStart = serverStatus === "stopped" || serverStatus === "crashed";
  const canStop = serverStatus === "running" || serverStatus === "starting";
  const stratum = status.data?.settings.flavor === "stratum";

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <CommandDialog onOpenChange={onOpenChange} open={open}>
      <Command>
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
            {stratum && (
              <CommandItem
                disabled={!canStop}
                onSelect={() => run(() => command.mutate("/stratum reload"))}
              >
                <Zap />
                <span>{t("command.reloadStratum")}</span>
              </CommandItem>
            )}
          </CommandGroup>
          <CommandGroup heading={t("command.actions")}>
            <CommandItem
              disabled={createBackup.isPending}
              onSelect={() => run(() => createBackup.mutate("server"))}
            >
              <CloudDownload />
              <span>{t("backups.backupServer")}</span>
            </CommandItem>
            <CommandItem
              disabled={updateAllMods.isPending}
              onSelect={() => run(() => updateAllMods.mutate())}
            >
              <PackagePlus />
              <span>{t("mods.updateAll")}</span>
            </CommandItem>
            <CommandItem onSelect={() => run(() => downloads.setOpen(true))}>
              <Archive />
              <span>{t("downloads.title")}</span>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() => void navigate({ to: "/console", search: { logs: "1" } }))
              }
            >
              <FileText />
              <span>{t("console.logFiles")}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div className="flex items-center justify-end border-t border-border px-3 py-2">
          <CommandShortcut>⌘K</CommandShortcut>
        </div>
      </Command>
    </CommandDialog>
  );
}
