import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import AppShell from "@/components/layout/AppShell";
import Configs from "@/pages/Configs";
import Console from "@/pages/Console";
import Dashboard from "@/pages/Dashboard";
import Mods from "@/pages/Mods";
import Settings from "@/pages/Settings";
import Versions from "@/pages/Versions";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/console",
  component: Console,
});

const versionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/versions",
  component: Versions,
});

const modsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mods",
  component: Mods,
});

const configsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config",
  component: Configs,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  consoleRoute,
  modsRoute,
  configsRoute,
  versionsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
