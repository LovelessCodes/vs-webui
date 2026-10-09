export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

let csrfToken: string | null = null;

export function setCsrf(token: string | null) {
  csrfToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  if (csrfToken && method !== "GET" && method !== "HEAD") {
    headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // not JSON — keep the status text
    }
    throw new ApiError(response.status, message || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface Me {
  authenticated: boolean;
  auth_disabled?: boolean;
  csrf: string | null;
  user?: { name: string; role: UserRole; totp_enabled?: boolean };
  public?: { enabled: boolean };
}

export type UserRole = "owner" | "operator" | "viewer";

export interface UserView {
  id: string;
  name: string;
  role: UserRole;
  created: number;
}

export interface AuditEntry {
  ts: number;
  actor: string;
  role: string;
  kind: string;
  method: string;
  path: string;
  status: number;
  action?: string;
  ip: string;
}

export interface Notification {
  id: number;
  ts: number;
  event: string;
  severity: "info" | "warning" | "error";
  text: string;
  read: boolean;
}

export interface ServerStatus {
  status: "not_installed" | "stopped" | "starting" | "running" | "stopping" | "crashed";
  pid: number | null;
  started_at: number | null;
  exit_code: number | null;
  version: string | null;
}

export interface InstallStatus {
  version: string;
  phase: "starting" | "downloading" | "verifying" | "extracting" | "done" | "error";
  downloaded: number;
  total: number;
  message: string | null;
  success: boolean | null;
}

export interface ScheduledTask {
  id: string;
  enabled: boolean;
  kind: "restart" | "backup" | "command";
  command?: string | null;
  times: string[];
  weekdays: number[];
  backup_before: boolean;
  date?: string | null;
  label?: string | null;
}

/** Enabled task with its next firing, computed by the manager. */
export interface TaskSummary {
  id: string;
  kind: "restart" | "backup" | "command";
  label?: string | null;
  next: number;
  at: string;
  backup_before: boolean;
}

export interface Settings {
  version?: string | null;
  flavor?: string;
  stratum_tag?: string | null;
  auto_start?: boolean;
  auto_restart?: boolean;
  start_params?: string;
  pinned_mods?: string[];
  favorite_mods?: string[];
  tasks?: ScheduledTask[];
  timezone?: string | null;
  backup_schedule?: string | null;
  backup_before_restart?: boolean;
  public_view?: boolean;
  public_sections?: string[];
  webhook_url?: string | null;
  webhook_events?: string[];
  collect_tps?: boolean;
  backup_retention?: number;
  backup_max_mb?: number | null;
  alert_tps?: boolean;
  alert_tps_min?: number;
  alert_disk?: boolean;
  alert_disk_percent?: number;
  alert_backup?: boolean;
  restart_required?: boolean;
}

export interface ConfigSummary {
  server_name: string | null;
  port: number | null;
  max_clients: number | null;
  password_protected: boolean;
}

export interface StatusResponse {
  status: ServerStatus;
  settings: Settings;
  install: InstallStatus | null;
  config: ConfigSummary | null;
  updates?: { game?: string | null; stratum?: string | null };
  unread_notifications?: number;
  tasks?: TaskSummary[];
  manager: {
    version: string;
    uptime: number;
    data_dir: string;
    auth_enabled: boolean;
  };
}

export interface VersionEntry {
  version: string;
  size: string;
  latest: boolean;
  installed: boolean;
  active: boolean;
}

export interface VersionsResponse {
  channel: string;
  versions: VersionEntry[];
}

export interface ConsoleLine {
  ts: string;
  line: string;
  /** Manager telemetry (e.g. /stats probes) — hidden by the console UI. */
  internal?: boolean;
}

export interface ServerConfigResponse {
  content: string;
  value: unknown;
  missing?: boolean;
}

// ── mods ────────────────────────────────────────────────────────────────────

export interface ModSummary {
  modid: number;
  assetid: number;
  name: string;
  summary: string;
  author: string;
  side: string;
  type: string;
  logo: string | null;
  tags: string[];
  downloads: number;
  follows: number;
  comments: number;
  trendingpoints: number;
  lastreleased: string;
  modidstrs: string[];
  urlalias: string | null;
}

export interface ModRelease {
  releaseid: number;
  mainfile: string;
  filename: string;
  fileid: number;
  downloads: number;
  tags: string[];
  modidstr: string;
  modversion: string;
  created: string;
  changelog: string | null;
}

export interface ModDetail {
  modid: number;
  name: string;
  text: string;
  author: string;
  side: string;
  type: string;
  logo: string | null;
  tags: string[];
  downloads: number;
  follows: number;
  trendingpoints: number;
  lastreleased: string;
  releases: ModRelease[];
}

export interface ModTag {
  tagid: number;
  name: string;
  color: string;
}

export interface InstalledMod {
  modid: string;
  name: string;
  authors: string[];
  version: string;
  file: string;
  dependencies: Record<string, string>;
}

export interface ModScanError {
  file: string;
  stage: string;
  message: string;
}

export interface InstalledModsResponse {
  mods: InstalledMod[];
  errors: ModScanError[];
}

export interface ModUpdate {
  releaseid: number;
  mainfile: string;
  filename: string;
  fileid: number;
  downloads: number;
  tags: string[];
  modidstr: string;
  modversion: string;
  created: string;
}

export interface ModUpdatesResponse {
  updates: Record<string, ModUpdate>;
}

export interface ModJob {
  id: number;
  action: string;
  modid: string;
  name: string;
  version: string | null;
  file: string | null;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  total: number;
  error: string | null;
  dependency: boolean;
  created_at: number;
  finished_at: number | null;
}

export interface ModJobsResponse {
  jobs: ModJob[];
}

export interface ModConfigFile {
  filename: string;
  content: string;
}

export interface ModConfigList {
  files: ModConfigFile[];
  errors: ModScanError[];
}

export interface StratumRelease {
  tag: string;
  name: string;
  vs_version: string;
  stratum_version: string;
  asset_name: string;
  asset_url: string;
  size: number;
  published_at: string;
  prerelease: boolean;
}

export interface OnlinePlayer {
  name: string;
  since: number;
}

export interface WhitelistEntry {
  name: string | null;
  uid: string | null;
}

export interface WhitelistView {
  entries: WhitelistEntry[];
  error: string | null;
}

export interface PlayersResponse {
  online: OnlinePlayer[];
  whitelist: WhitelistView;
  whitelist_enabled: boolean | null;
}

export interface BackupEntry {
  name: string;
  size: number;
  modified: number;
  integrity?: { ok: boolean; checked: number; error?: string };
}

export interface RestoreProgress {
  name: string;
  done: number;
  total: number;
  entries: number;
  finished: boolean;
}

export interface LogFileEntry {
  name: string;
  size: number;
  modified: number;
}

export interface ApiToken {
  id: string;
  label: string;
  created: number;
  last_used: number | null;
  scope: "full" | "read";
}

export interface SessionView {
  id: string;
  user: string;
  created: number;
  last_seen: number;
  ip: string;
  agent: string;
  current: boolean;
}

export interface MetricSample {
  ts: number;
  cpu: number;
  memory: number;
  tps: number | null;
  players: number;
}

export interface StorageArea {
  name: string;
  bytes: number;
}

export interface StorageBuild {
  id: string;
  bytes: number;
}

export interface PlayerRecord {
  name: string;
  first_seen: number;
  last_seen: number;
  seconds: number;
}

export interface SaveEntry {
  name: string;
  size: number;
  modified: number;
  active: boolean;
  legacy: boolean;
  /** Configured in serverconfig.json but not yet generated by the server. */
  pending: boolean;
}

/** Read-only data exposed to unauthenticated visitors (enabled sections only). */
export interface PublicView {
  enabled: boolean;
  status?: {
    status: ServerStatus["status"];
    started_at: number | null;
    version: string | null;
    online: number;
  };
  build?: {
    version?: string | null;
    flavor?: string;
    stratum_tag?: string | null;
    updates?: { game?: string | null; stratum?: string | null };
  };
  metrics?: { samples: MetricSample[] };
  info?: {
    server_name?: string | null;
    port?: number | null;
    max_clients?: number | null;
    password_protected?: boolean;
  } | null;
  players?: Array<{ name: string; since: number }>;
  history?: PlayerRecord[];
}

export interface StorageView {
  areas: StorageArea[];
  free_bytes: number;
  total_bytes: number;
  vanilla_builds: StorageBuild[];
  stratum_builds: StorageBuild[];
}

export const api = {
  me: () => request<Me>("/api/me"),
  login: (username: string, password: string, code?: string) =>
    request<{ ok: boolean; csrf?: string; totp_required?: boolean }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password, code }),
    }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    request<{ ok: boolean }>("/api/password", {
      method: "PUT",
      body: JSON.stringify({ current, new: next }),
    }),

  users: () => request<{ users: UserView[] }>("/api/users"),
  sessions: () => request<{ sessions: SessionView[] }>("/api/sessions"),
  revokeSession: (id: string) =>
    request<{ ok: boolean }>("/api/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  revokeOtherSessions: () =>
    request<{ ok: boolean; removed: number }>("/api/sessions/revoke-others", { method: "POST" }),
  totpStatus: () => request<{ enabled: boolean }>("/api/2fa"),
  totpSetup: () => request<{ secret: string; url: string }>("/api/2fa/setup", { method: "POST" }),
  totpEnable: (code: string) =>
    request<{ ok: boolean; recovery_codes: string[] }>("/api/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  totpDisable: (code: string) =>
    request<{ ok: boolean }>("/api/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  createUser: (body: { name: string; password: string; role: UserRole }) =>
    request<{ ok: boolean; user: UserView }>("/api/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateUser: (id: string, body: { role?: UserRole; password?: string }) =>
    request<{ ok: boolean; user: UserView }>(`/api/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  audit: (limit = 200) => request<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`),

  notifications: () => request<{ notifications: Notification[]; unread: number }>("/api/notifications"),
  markNotificationsRead: (ids?: number[]) =>
    request<{ ok: boolean; unread: number }>("/api/notifications/read", {
      method: "POST",
      body: JSON.stringify(ids ? { ids } : {}),
    }),
  clearNotifications: () =>
    request<{ ok: boolean }>("/api/notifications", { method: "DELETE" }),

  status: () => request<StatusResponse>("/api/status"),
  start: () => request<{ ok: boolean }>("/api/server/start", { method: "POST" }),
  stop: () => request<{ ok: boolean }>("/api/server/stop", { method: "POST" }),
  restart: () => request<{ ok: boolean }>("/api/server/restart", { method: "POST" }),
  command: (command: string) =>
    request<{ ok: boolean }>("/api/server/command", {
      method: "POST",
      body: JSON.stringify({ command }),
    }),

  versions: (channel: string) =>
    request<VersionsResponse>(`/api/versions?channel=${encodeURIComponent(channel)}`),
  install: (version: string, channel: string) =>
    request<{ ok: boolean }>("/api/versions/install", {
      method: "POST",
      body: JSON.stringify({ version, channel }),
    }),
  setActiveVersion: (version: string) =>
    request<{ ok: boolean }>("/api/server/version", {
      method: "POST",
      body: JSON.stringify({ version }),
    }),

  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Partial<{
    auto_start: boolean;
    auto_restart: boolean;
    start_params: string;
    tasks: ScheduledTask[];
    timezone: string;
    backup_retention: number;
    backup_max_mb: number;
    webhook_url: string;
    webhook_events: string[];
    collect_tps: boolean;
    public_view: boolean;
    public_sections: string[];
    alert_tps: boolean;
    alert_tps_min: number;
    alert_disk: boolean;
    alert_disk_percent: number;
    alert_backup: boolean;
  }>) =>
    request<Settings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  consoleHistory: (limit = 500) =>
    request<{ lines: ConsoleLine[] }>(`/api/console/history?limit=${limit}`),

  logFiles: () => request<{ files: LogFileEntry[] }>("/api/logs"),
  logTail: (name: string, tail = 2000) =>
    request<{ name: string; content: string; truncated: boolean }>(
      `/api/logs/${encodeURIComponent(name)}?tail=${tail}`,
    ),
  testWebhook: () => request<{ ok: boolean }>("/api/webhook/test", { method: "POST" }),

  tokens: () => request<{ tokens: ApiToken[] }>("/api/tokens"),
  createToken: (label: string, scope: "full" | "read") =>
    request<{ token: ApiToken; plaintext: string }>("/api/tokens", {
      method: "POST",
      body: JSON.stringify({ label, scope }),
    }),
  revokeToken: (id: string) =>
    request<{ ok: boolean }>(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),

  metrics: () => request<{ running: boolean; samples: MetricSample[] }>("/api/metrics"),
  publicView: () => request<PublicView>("/api/public"),
  storage: () => request<StorageView>("/api/storage"),
  deleteVersion: (version: string) =>
    request<{ ok: boolean }>(`/api/versions/${encodeURIComponent(version)}`, { method: "DELETE" }),
  deleteStratumRelease: (tag: string) =>
    request<{ ok: boolean }>(`/api/stratum/${encodeURIComponent(tag)}`, { method: "DELETE" }),

  playerHistory: () => request<{ players: PlayerRecord[] }>("/api/players/history"),
  removeWhitelistEntry: (body: { uid?: string; name?: string }) =>
    request<{ ok: boolean; mode: string; removed?: boolean }>("/api/whitelist/remove", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  saves: () => request<{ saves: SaveEntry[] }>("/api/saves"),
  createWorld: (body: {
    name: string;
    seed?: string;
    play_style?: string;
    world_type?: string;
    world_configuration?: Record<string, string>;
  }) =>
    request<{ ok: boolean; name: string; first_boot: boolean; restart_required: boolean }>(
      "/api/saves/create",
      { method: "POST", body: JSON.stringify(body) },
    ),
  uploadSave: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ ok: boolean; name: string }>("/api/saves/upload", {
      method: "POST",
      body,
    });
  },
  activateSave: (name: string) =>
    request<{ ok: boolean; restart_required: boolean }>(
      `/api/saves/${encodeURIComponent(name)}/activate`,
      { method: "POST" },
    ),
  duplicateSave: (name: string, newName: string) =>
    request<{ ok: boolean; name: string }>(
      `/api/saves/${encodeURIComponent(name)}/duplicate`,
      { method: "POST", body: JSON.stringify({ name: newName }) },
    ),
  renameSave: (name: string, newName: string) =>
    request<{ ok: boolean; name: string; active: boolean }>(
      `/api/saves/${encodeURIComponent(name)}/rename`,
      { method: "POST", body: JSON.stringify({ name: newName }) },
    ),
  deleteSave: (name: string) =>
    request<{ ok: boolean }>(`/api/saves/${encodeURIComponent(name)}`, { method: "DELETE" }),
  worldConfig: (name: string) =>
    request<{ content: string; missing: boolean }>(
      `/api/saves/${encodeURIComponent(name)}/config`,
    ),
  saveWorldConfig: (name: string, content: string) =>
    request<{ ok: boolean; restart_required: boolean }>(
      `/api/saves/${encodeURIComponent(name)}/config`,
      { method: "PUT", body: JSON.stringify({ content }) },
    ),

  serverConfig: () => request<ServerConfigResponse>("/api/serverconfig"),

  modbMods: (versions: string[], text: string) => {
    const params = new URLSearchParams();
    if (versions.length > 0) params.set("versions", versions.join(","));
    if (text) params.set("text", text);
    const query = params.toString();
    return request<{ mods: ModSummary[] }>(`/api/modb/mods${query ? `?${query}` : ""}`);
  },
  modbTags: () => request<{ tags: ModTag[] }>("/api/modb/tags"),
  modbGameVersions: () =>
    request<{ gameversions: Array<{ tagid: number; name: string; color: string }> }>(
      "/api/modb/gameversions",
    ),
  modbDetail: (modid: string | number) =>
    request<{ mod: ModDetail }>(`/api/modb/mod/${encodeURIComponent(String(modid))}`),

  installedMods: () => request<InstalledModsResponse>("/api/mods/installed"),
  modUpdates: () => request<ModUpdatesResponse>("/api/mods/updates"),
  modJobs: () => request<ModJobsResponse>("/api/mods/jobs"),
  installMod: (body: { modid: string; version?: string; constraint?: string; name?: string }) =>
    request<{ job_id: number; backup: string }>("/api/mods/install", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeMod: (file: string) =>
    request<{ job_id: number; backup: string }>("/api/mods/remove", {
      method: "POST",
      body: JSON.stringify({ file }),
    }),
  updateMod: (body: { modid: string; version: string; file: string; name?: string }) =>
    request<{ job_id: number; backup: string }>("/api/mods/update", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAllMods: () =>
    request<{ job_ids: number[]; backup: string | null }>("/api/mods/update-all", {
      method: "POST",
    }),
  pinMod: (modid: string, pinned: boolean) =>
    request<Settings>("/api/mods/pin", {
      method: "POST",
      body: JSON.stringify({ modid, pinned }),
    }),
  favoriteMod: (modid: string, favorite: boolean) =>
    request<Settings>("/api/mods/favorite", {
      method: "POST",
      body: JSON.stringify({ modid, favorite }),
    }),

  configs: () => request<ModConfigList>("/api/configs"),
  saveConfig: (filename: string, content: string) =>
    request<{ ok: boolean; restart_required: boolean }>(
      `/api/configs/${encodeURIComponent(filename)}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    ),
  saveServerConfig: (content: string) =>
    request<{ ok: boolean; restart_required: boolean }>("/api/serverconfig", {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  stratumReleases: () => request<{ releases: StratumRelease[] }>("/api/stratum/releases"),
  installStratum: (tag: string) =>
    request<{ ok: boolean; tag: string }>("/api/stratum/install", {
      method: "POST",
      body: JSON.stringify({ tag }),
    }),
  stratumConfigs: () => request<ModConfigList>("/api/stratum/configs"),
  saveStratumConfig: (filename: string, content: string) =>
    request<{ ok: boolean; restart_required: boolean; reload_command: string }>(
      `/api/stratum/configs/${encodeURIComponent(filename)}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    ),
  setFlavor: (flavor: "vanilla" | "stratum") =>
    request<{ ok: boolean; settings: Settings; restart_required: boolean }>(
      "/api/server/flavor",
      {
        method: "POST",
        body: JSON.stringify({ flavor }),
      },
    ),

  players: () => request<PlayersResponse>("/api/players"),
  setWhitelistMode: (enabled: boolean) =>
    request<{ ok: boolean; restart_required: boolean }>("/api/whitelist/mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),

  backups: () => request<{ backups: BackupEntry[] }>("/api/backups"),
  createBackup: (kind: "server" | "mods") =>
    request<{ ok: boolean; name: string }>("/api/backups", {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),
  restoreBackup: (name: string, startAfter = false) =>
    request<{ ok: boolean; started: boolean }>(
      `/api/backups/${encodeURIComponent(name)}/restore${startAfter ? "?start_after=true" : ""}`,
      { method: "POST" },
    ),
  restoreStatus: () => request<{ progress: RestoreProgress | null }>("/api/backups/restore-status"),
  verifyBackup: (name: string) =>
    request<{ ok: boolean }>(`/api/backups/${encodeURIComponent(name)}/verify`, {
      method: "POST",
    }),
  deleteBackup: (name: string) =>
    request<{ ok: boolean }>(`/api/backups/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  backupDownloadUrl: (name: string) => `/api/backups/${encodeURIComponent(name)}/download`,
};

export function consoleStream(): EventSource {
  return new EventSource("/api/console/stream");
}
