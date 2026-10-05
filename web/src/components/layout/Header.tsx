import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

const pageMeta: Record<string, { title: string; description?: string }> = {
  "/": {
    title: "Dashboard",
    description: "Server status and quick actions",
  },
  "/console": {
    title: "Console",
    description: "Live server output and commands",
  },
  "/mods": {
    title: "Mods",
    description: "Browse the mod database and manage installed mods",
  },
  "/versions": {
    title: "Versions",
    description: "Install and switch Vintage Story builds",
  },
  "/settings": {
    title: "Settings",
    description: "Manager configuration and access",
  },
};

export default function Header() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const fetching = queryClient.isFetching();
  const meta = pageMeta[pathname] ?? { title: "VS WebUI" };

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border-default px-4">
      <h2 className="text-sm font-semibold whitespace-nowrap">{meta.title}</h2>
      {meta.description && (
        <p className="truncate text-xs text-text-secondary">{meta.description}</p>
      )}
      <div className="flex-1" />
      <Button
        disabled={fetching > 0}
        onClick={() => void queryClient.refetchQueries()}
        size="sm"
        variant="ghost"
      >
        <RefreshCw className={fetching > 0 ? "animate-spin" : undefined} />
        Refresh
      </Button>
    </header>
  );
}
