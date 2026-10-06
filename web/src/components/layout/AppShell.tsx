import { useHotkey } from "@tanstack/react-hotkeys";
import { Outlet } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import CommandPalette from "@/components/command-palette";
import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast";
import { useMe } from "@/hooks/use-api";

import Login from "@/pages/Login";

export default function AppShell() {
  const me = useMe();
  const [commandOpen, setCommandOpen] = useState(false);

  useHotkey("Mod+K", () => setCommandOpen((open) => !open));

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!me.data?.authenticated) {
    return <Login />;
  }

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <Toaster />
      <Sidebar />
      <SidebarInset className="min-w-0 overflow-hidden">
        <Header />
        <main className="min-h-0 flex-1 overflow-hidden p-6">
          <Outlet />
        </main>
      </SidebarInset>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </SidebarProvider>
  );
}
