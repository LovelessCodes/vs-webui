import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

const pageMeta: Record<string, { titleKey: string; descriptionKey?: string }> = {
  "/": { titleKey: "pages.dashboard.title", descriptionKey: "pages.dashboard.description" },
  "/console": { titleKey: "pages.console.title", descriptionKey: "pages.console.description" },
  "/mods": { titleKey: "pages.mods.title", descriptionKey: "pages.mods.description" },
  "/config": { titleKey: "pages.configs.title", descriptionKey: "pages.configs.description" },
  "/players": { titleKey: "pages.players.title", descriptionKey: "pages.players.description" },
  "/backups": { titleKey: "pages.backups.title", descriptionKey: "pages.backups.description" },
  "/versions": { titleKey: "pages.versions.title", descriptionKey: "pages.versions.description" },
  "/settings": { titleKey: "pages.settings.title", descriptionKey: "pages.settings.description" },
};

/** Page title row inside the sidebar inset, below the fixed app bar. */
export default function PageHeader() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const meta = pageMeta[pathname] ?? { titleKey: "brand.name" };

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
      <h2 className="text-sm font-semibold whitespace-nowrap">{t(meta.titleKey)}</h2>
      {meta.descriptionKey && (
        <p className="truncate text-xs text-muted-foreground">{t(meta.descriptionKey)}</p>
      )}
    </header>
  );
}
