import { formatForDisplay } from "@tanstack/react-hotkeys";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Languages, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import ThemeToggle from "@/components/common/ThemeToggle";
import DownloadsButton from "@/components/downloads/DownloadsButton";
import NotificationBell from "@/components/layout/NotificationBell";
import ServerControls from "@/components/layout/ServerControls";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { LANGUAGES, setLanguage } from "@/lib/i18n";
import { revealTransition } from "@/lib/theme-transition";

/**
 * Full-width app bar spanning above the sidebar and the page inset
 * (Story Forge titlebar layout).
 */
export default function Header({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const fetching = queryClient.isFetching();

  return (
    <header
      className="fixed inset-x-0 top-0 z-30 flex h-11 items-center gap-2 bg-sidebar px-3"
      data-slot="app-header"
    >
      <SidebarTrigger />
      <div className="bg-muted block h-2/3 w-0.5" />
      <span className="text-muted-foreground hidden truncate text-[10px] font-medium tracking-widest whitespace-nowrap uppercase sm:inline">
        {t("brand.name")}
      </span>
      <div className="flex-1" />

      <ServerControls />
      <span className="h-5 w-px bg-border" />

      <div className="flex items-center gap-1">
        <DownloadsButton />
        <NotificationBell />

        <Button
          className="gap-2 text-muted-foreground"
          onClick={onOpenPalette}
          size="sm"
          title={t("command.search")}
          variant="outline"
        >
          <Search />
          <span className="hidden md:inline">{t("command.search")}</span>
          <kbd className="pointer-events-none hidden rounded-none border px-1 font-sans text-[10px] md:inline">
            {formatForDisplay("Mod")}K
          </kbd>
        </Button>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t("language.label")}
                className="gap-2 text-muted-foreground"
                size="sm"
                variant="ghost"
              />
            }
          >
            <Languages />
            <span className="hidden md:inline">{t(`language.${i18n.language}`)}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
              {LANGUAGES.map((language) => (
                <DropdownMenuItem
                  key={language}
                  onClick={(event) => {
                    if (language === i18n.language) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    revealTransition(() => setLanguage(language), {
                      origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
                    });
                  }}
                >
                  <span className="flex-1">{t(`language.${language}`)}</span>
                  {i18n.language === language && <Check />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          aria-label={t("common.refresh")}
          disabled={fetching > 0}
          onClick={() => void queryClient.refetchQueries()}
          size="icon-sm"
          title={t("common.refresh")}
          variant="ghost"
        >
          <RefreshCw className={fetching > 0 ? "animate-spin" : undefined} />
        </Button>
      </div>
    </header>
  );
}
