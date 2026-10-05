import { Outlet } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import { useMe } from "@/hooks/use-api";

import Login from "@/pages/Login";

export default function AppShell() {
  const me = useMe();

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary">
        <Loader2 className="size-5 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!me.data?.authenticated) {
    return <Login />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
