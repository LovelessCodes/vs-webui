import { useHotkey } from "@tanstack/react-hotkeys";
import { Outlet } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import CommandPalette from "@/components/command-palette";
import { ConnectionGate, ConnectionProvider } from "@/components/connection/ConnectionProvider";
import { DownloadsProvider } from "@/components/downloads/downloads-sheet";
import Header from "@/components/layout/Header";
import PageHeader from "@/components/layout/PageHeader";
import Sidebar from "@/components/layout/Sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast";
import { useMe } from "@/hooks/use-api";

import Login from "@/pages/Login";
import PublicDashboard from "@/pages/PublicDashboard";

export default function AppShell() {
  const me = useMe();
  const [commandOpen, setCommandOpen] = useState(false);
  const [previewGuest] = useState(
    () => new URLSearchParams(window.location.search).get("as") === "guest",
  );

  useHotkey("Mod+K", () => setCommandOpen((open) => !open));

  let content;
  if (me.isLoading) {
    content = (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (!me.data?.authenticated) {
    // Visitors get the guest page when the admin enabled it.
    content = me.data?.public?.enabled ? <PublicDashboard /> : <Login />;
  } else if (previewGuest) {
    content = <PublicDashboard preview />;
  } else {
    content = (
      <SidebarProvider className="h-svh overflow-hidden">
        <DownloadsProvider>
          <Toaster />
          <Header onOpenPalette={() => setCommandOpen(true)} />
          <Sidebar />
          <SidebarInset className="mt-11 min-w-0 overflow-hidden md:mt-11">
            <PageHeader />
            <main className="min-h-0 flex-1 overflow-hidden p-6">
              <Outlet />
            </main>
          </SidebarInset>
          <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
        </DownloadsProvider>
      </SidebarProvider>
    );
  }

  return (
    <ConnectionProvider>
      <ConnectionGate>{content}</ConnectionGate>
    </ConnectionProvider>
  );
}
