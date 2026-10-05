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

// ── mods ────────────────────────────────────────────────────────────────────

export function useModDb(version: string | undefined, text: string, enabled = true) {
  return useQuery({
    queryKey: ["modb", version ?? "", text],
    queryFn: () => api.modbMods(version, text),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useModTags(enabled = true) {
  return useQuery({
    queryKey: ["modb", "tags"],
    queryFn: api.modbTags,
    staleTime: 60 * 60_000,
    retry: false,
    enabled,
  });
}

export function useModDetail(modid: string | null) {
  return useQuery({
    queryKey: ["modb", "detail", modid],
    queryFn: () => api.modbDetail(modid as string),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: Boolean(modid),
  });
}

export function useInstalledMods(enabled = true) {
  return useQuery({
    queryKey: ["mods", "installed"],
    queryFn: api.installedMods,
    staleTime: 5_000,
    retry: false,
    enabled,
  });
}

export function useModUpdates(enabled = true) {
  return useQuery({
    queryKey: ["mods", "updates"],
    queryFn: api.modUpdates,
    staleTime: Infinity,
    retry: false,
    enabled,
  });
}

export function useModJobs(enabled = true) {
  return useQuery({
    queryKey: ["mods", "jobs"],
    queryFn: api.modJobs,
    retry: false,
    enabled,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const active = jobs.some((job) => job.status === "queued" || job.status === "running");
      return active ? 1_000 : 5_000;
    },
  });
}

/** Mod mutations refresh the job list; the page invalidates the rest on completion. */
function useModMutation<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods", "jobs"] });
    },
  });
}

export function useInstallMod() {
  return useModMutation<{ modid: string; version?: string; constraint?: string; name?: string }>(
    (body) => api.installMod(body),
  );
}

export function useRemoveMod() {
  return useModMutation<string>((file) => api.removeMod(file));
}

export function useUpdateMod() {
  return useModMutation<{ modid: string; version: string; file: string; name?: string }>((body) =>
    api.updateMod(body),
  );
}

export function useUpdateAllMods() {
  return useModMutation<void>(() => api.updateAllMods());
}

export function usePinMod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ modid, pinned }: { modid: string; pinned: boolean }) =>
      api.pinMod(modid, pinned),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

// ── configs ─────────────────────────────────────────────────────────────────

export function useModConfigs(enabled = true) {
  return useQuery({
    queryKey: ["configs"],
    queryFn: api.configs,
    staleTime: 5_000,
    retry: false,
    enabled,
  });
}

export function useSaveModConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, newCode }: { file: string; newCode: string }) =>
      api.saveConfig(file, newCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["configs"] });
    },
  });
}

export function useServerConfig(enabled = true) {
  return useQuery({
    queryKey: ["serverconfig"],
    queryFn: api.serverConfig,
    staleTime: 5_000,
    retry: false,
    enabled,
  });
}

export function useSaveServerConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.saveServerConfig(content),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["serverconfig"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

// ── stratum ─────────────────────────────────────────────────────────────────

export function useStratumReleases(enabled = true) {
  return useQuery({
    queryKey: ["stratum", "releases"],
    queryFn: api.stratumReleases,
    staleTime: 5 * 60_000,
    retry: false,
    enabled,
  });
}

export function useInstallStratum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) => api.installStratum(tag),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

export function useStratumConfigs(enabled = true) {
  return useQuery({
    queryKey: ["stratum", "configs"],
    queryFn: api.stratumConfigs,
    staleTime: 5_000,
    retry: false,
    enabled,
  });
}

export function useSaveStratumConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, newCode }: { file: string; newCode: string }) =>
      api.saveStratumConfig(file, newCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stratum", "configs"] });
    },
  });
}

export function useSetFlavor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flavor: "vanilla" | "stratum") => api.setFlavor(flavor),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

// ── players & backups ───────────────────────────────────────────────────────

export function usePlayers(enabled = true) {
  return useQuery({
    queryKey: ["players"],
    queryFn: api.players,
    refetchInterval: 5_000,
    retry: false,
    enabled,
  });
}

export function useSetWhitelistMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.setWhitelistMode(enabled),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["players"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["serverconfig"] });
    },
  });
}

export function useBackups(enabled = true) {
  return useQuery({
    queryKey: ["backups"],
    queryFn: api.backups,
    refetchInterval: 15_000,
    retry: false,
    enabled,
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: "server" | "mods") => api.createBackup(kind),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.restoreBackup(name),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
      void queryClient.invalidateQueries({ queryKey: ["configs"] });
      void queryClient.invalidateQueries({ queryKey: ["stratum"] });
      void queryClient.invalidateQueries({ queryKey: ["serverconfig"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteBackup(name),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}
