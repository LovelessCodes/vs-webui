import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, setCsrf, type UserRole } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import i18n from "@/lib/i18n";
import { toast } from "@/lib/notify";

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

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: ["users"],
    queryFn: api.users,
    retry: false,
    enabled,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createUser>[0]) => api.createUser(body),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: (data) => toast.success(i18n.t("settings.userCreated", { name: data.user.name })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: UserRole; password?: string }) =>
      api.updateUser(id, body),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("common.saved")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("settings.userDeleted")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useAudit(enabled = true) {
  return useQuery({
    queryKey: ["audit"],
    queryFn: () => api.audit(300),
    retry: false,
    enabled,
    refetchInterval: 30_000,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    retry: false,
    enabled,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: number[]) => api.markNotificationsRead(ids),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

export function useClearNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearNotifications(),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
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
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ version, channel }: { version: string; channel: string }) =>
      api.install(version, channel),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
    onSuccess: (_data, args) => toast.success(i18n.t("toasts.queued", { name: args.version })),
  });
}

export function useSetActiveVersion() {
  return useServerAction<string>((version) => api.setActiveVersion(version));
}

// ── mods ────────────────────────────────────────────────────────────────────

/** Canonical query key for the ModDB list fetch (used by the author filter). */
export const modbQueryKey = (versions: string[], text: string) =>
  ["modb", [...versions].sort().join(","), text] as const;

export function useModDb(versions: string[], text: string, enabled = true) {
  return useQuery({
    queryKey: modbQueryKey(versions, text),
    queryFn: () => api.modbMods([...versions].sort(), text),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useGameVersions(enabled = true) {
  return useQuery({
    queryKey: ["modb", "gameversions"],
    queryFn: api.modbGameVersions,
    staleTime: 60 * 60_000,
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
function useModMutation<TArgs>(
  mutationFn: (args: TArgs) => Promise<unknown>,
  successMessage?: (args: TArgs) => string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["mods", "jobs"] });
    },
    onSuccess: (_data, args) => {
      const message = successMessage?.(args);
      if (message) toast.success(message);
    },
  });
}

export function useInstallMod() {
  return useModMutation<{ modid: string; version?: string; constraint?: string; name?: string }>(
    (body) => api.installMod(body),
    (body) => i18n.t("toasts.queued", { name: body.name ?? body.modid }),
  );
}

export function useRemoveMod() {
  return useModMutation<string>(
    (file) => api.removeMod(file),
    (file) => i18n.t("toasts.queued", { name: file }),
  );
}

export function useUpdateMod() {
  return useModMutation<{ modid: string; version: string; file: string; name?: string }>(
    (body) => api.updateMod(body),
    (body) => i18n.t("toasts.queued", { name: body.name ?? body.modid }),
  );
}

export function useUpdateAllMods() {
  return useModMutation<void>(() => api.updateAllMods(), () => null);
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

export function useFavoriteMod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ modid, favorite }: { modid: string; favorite: boolean }) =>
      api.favoriteMod(modid, favorite),
    onSettled: () => {
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
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => {
      toast.success(i18n.t("common.saved"));
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
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: (data) => {
      toast.success(
        data.restart_required ? i18n.t("configs.savedRestart") : i18n.t("common.saved"),
      );
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
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
    onSuccess: (_data, tag) => toast.success(i18n.t("toasts.queued", { name: tag })),
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
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: (data) => {
      toast.success(
        data.restart_required ? i18n.t("configs.savedRestart") : i18n.t("configs.savedReload"),
      );
      void queryClient.invalidateQueries({ queryKey: ["stratum", "configs"] });
    },
  });
}

export function useSetFlavor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flavor: "vanilla" | "stratum") => api.setFlavor(flavor),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onSuccess: () => toast.success(i18n.t("common.saved")),
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

export function usePlayerHistory(enabled = true) {
  return useQuery({
    queryKey: ["players", "history"],
    queryFn: api.playerHistory,
    staleTime: 10_000,
    retry: false,
    enabled,
  });
}

export function useRemoveWhitelistEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { uid?: string; name?: string }) => api.removeWhitelistEntry(body),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["players"] });
    },
  });
}

export function useSaves(enabled = true) {
  return useQuery({
    queryKey: ["saves"],
    queryFn: api.saves,
    staleTime: 5_000,
    retry: false,
    enabled,
  });
}

export function useUploadSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadSave(file),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: (data) => toast.success(i18n.t("worlds.uploaded", { name: data.name })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["saves"] });
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
    },
  });
}

export function useCreateWorld() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createWorld>[0]) => api.createWorld(body),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: (data) => toast.success(i18n.t("worlds.created", { name: data.name })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["saves"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["serverconfig"] });
    },
  });
}

export function useActivateSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.activateSave(name),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("common.saved")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["saves"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["serverconfig"] });
    },
  });
}

export function useDeleteSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteSave(name),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["saves"] });
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
    },
  });
}

export function useDuplicateSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, newName }: { name: string; newName: string }) =>
      api.duplicateSave(name, newName),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: (data) => toast.success(i18n.t("worlds.duplicated", { name: data.name })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["saves"] });
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
    },
  });
}

export function useRenameSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, newName }: { name: string; newName: string }) =>
      api.renameSave(name, newName),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: (data) => toast.success(i18n.t("worlds.renamed", { name: data.name })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["saves"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["serverconfig"] });
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
    },
  });
}

export function useWorldConfig(name: string | null) {
  return useQuery({
    queryKey: ["saves", name, "config"],
    queryFn: () => api.worldConfig(name as string),
    retry: false,
    enabled: Boolean(name),
  });
}

export function useSaveWorldConfig(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.saveWorldConfig(name, content),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("common.saved")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["saves", name, "config"] });
    },
  });
}

export function useSetWhitelistMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.setWhitelistMode(enabled),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["players"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["serverconfig"] });
    },
    onSuccess: (data) =>
      toast.success(
        data.restart_required ? i18n.t("configs.savedRestart") : i18n.t("common.saved"),
      ),
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

export function useLogFiles(enabled = true) {
  return useQuery({
    queryKey: ["logs"],
    queryFn: api.logFiles,
    staleTime: 10_000,
    retry: false,
    enabled,
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: () => api.testWebhook(),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("settings.webhookTestSent")),
  });
}

export function useTokens(enabled = true) {
  return useQuery({
    queryKey: ["tokens"],
    queryFn: api.tokens,
    retry: false,
    enabled,
  });
}

export function useCreateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ label, scope }: { label: string; scope: "full" | "read" }) =>
      api.createToken(label, scope),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
}

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    retry: false,
    enabled,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("settings.sessionRevoked")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: (data) =>
      toast.success(i18n.t("settings.sessionsRevoked", { n: data.removed })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useTotpSetup() {
  return useMutation({
    mutationFn: () => api.totpSetup(),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
  });
}

export function useTotpEnable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.totpEnable(code),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useTotpDisable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.totpDisable(code),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("settings.totpDisabled")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeToken(id),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
}

export function useVerifyBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.verifyBackup(name),
    onError: (error) =>
      toast.error(i18n.t("backups.verifyFailed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("backups.verifyOk")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

export function useRestoreStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["restore-status"],
    queryFn: api.restoreStatus,
    retry: false,
    enabled,
    refetchInterval: enabled ? 500 : false,
  });
}

export function useChat(after: number | null) {
  return useQuery({
    queryKey: ["chat", after],
    queryFn: () => api.chat(after ?? undefined),
    retry: false,
    refetchInterval: 2_000,
  });
}

export function usePlayerProfiles(enabled = true) {
  return useQuery({
    queryKey: ["player-profiles"],
    queryFn: api.playerProfiles,
    retry: false,
    enabled,
  });
}

export function useSetPlayerNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, notes }: { name: string; notes: string }) =>
      api.setPlayerNote(name, notes),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("common.saved")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["player-profiles"] });
    },
  });
}

export function usePlayerBans(enabled = true) {
  return useQuery({
    queryKey: ["player-bans"],
    queryFn: api.playerBans,
    retry: false,
    enabled,
  });
}

export function useRemoveBan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; uid?: string }) => api.removeBan(body),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("players.unbanned")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["player-bans"] });
      void queryClient.invalidateQueries({ queryKey: ["player-profiles"] });
    },
  });
}

export function usePlayerRoles(enabled = true) {
  return useQuery({
    queryKey: ["player-roles"],
    queryFn: api.playerRoles,
    retry: false,
    enabled,
  });
}

export function useSetPlayerRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, code }: { name: string; code: string }) =>
      api.setPlayerRole(name, code),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSuccess: () => toast.success(i18n.t("players.roleAssigned")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["player-roles"] });
      void queryClient.invalidateQueries({ queryKey: ["player-profiles"] });
    },
  });
}

export function useMetricsHistory(hours: number, enabled: boolean) {
  return useQuery({
    queryKey: ["metrics-history", hours],
    queryFn: () => api.metricsHistory(hours),
    retry: false,
    enabled,
    staleTime: 60_000,
  });
}

export function useMetrics(enabled = true) {
  return useQuery({
    queryKey: ["metrics"],
    queryFn: api.metrics,
    refetchInterval: 5_000,
    retry: false,
    enabled,
  });
}

export function usePublicView(enabled = true) {
  return useQuery({
    queryKey: ["public"],
    queryFn: api.publicView,
    refetchInterval: 5_000,
    retry: false,
    enabled,
  });
}

export function useStorage(enabled = true) {
  return useQuery({
    queryKey: ["storage"],
    queryFn: api.storage,
    staleTime: 30_000,
    retry: false,
    enabled,
  });
}

export function useDeleteVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => api.deleteVersion(version),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["versions"] });
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

export function useDeleteStratumRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) => api.deleteStratumRelease(tag),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["stratum", "releases"] });
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: "server" | "mods") => api.createBackup(kind),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onSuccess: (data) => toast.success(i18n.t("toasts.created", { name: data.name })),
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, startAfter }: { name: string; startAfter?: boolean }) =>
      api.restoreBackup(name, startAfter),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
      void queryClient.invalidateQueries({ queryKey: ["mods"] });
      void queryClient.invalidateQueries({ queryKey: ["configs"] });
      void queryClient.invalidateQueries({ queryKey: ["stratum"] });
      void queryClient.invalidateQueries({ queryKey: ["serverconfig"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
    onSuccess: (_data, { name }) => toast.success(i18n.t("toasts.restored", { name })),
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteBackup(name),
    onError: (error) =>
      toast.error(i18n.t("toasts.failed", { message: errorMessage(error) })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onSuccess: (_data, name) => toast.success(i18n.t("toasts.deleted", { name })),
  });
}
