import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, setCsrf } from "@/lib/api";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await api.me();
      if (me.csrf) setCsrf(me.csrf);
      return me;
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useStatus(enabled = true) {
  return useQuery({
    queryKey: ["status"],
    queryFn: api.status,
    refetchInterval: 2_000,
    retry: false,
    enabled,
  });
}

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    retry: false,
    enabled,
  });
}

export function useVersions(channel: string, enabled = true) {
  return useQuery({
    queryKey: ["versions", channel],
    queryFn: () => api.versions(channel),
    refetchInterval: 30_000,
    retry: false,
    enabled,
  });
}

export function useConsolePreview(enabled = true) {
  return useQuery({
    queryKey: ["console-preview"],
    queryFn: () => api.consoleHistory(20),
    refetchInterval: 5_000,
    retry: false,
    enabled,
  });
}

/** Invalidate the queries that the server actions affect. */
function useServerAction<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

export function useServerStart() {
  return useServerAction<void>(() => api.start());
}

export function useServerStop() {
  return useServerAction<void>(() => api.stop());
}

export function useServerRestart() {
  return useServerAction<void>(() => api.restart());
}

export function useServerCommand() {
  return useServerAction<string>((command) => api.command(command));
}

export function useInstallVersion() {
  return useServerAction<{ version: string; channel: string }>(({ version, channel }) =>
    api.install(version, channel),
  );
}

export function useSetActiveVersion() {
  return useServerAction<string>((version) => api.setActiveVersion(version));
}
