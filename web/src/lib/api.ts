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
  if (init.body) headers.set("content-type", "application/json");
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

export interface Settings {
  version?: string | null;
  flavor?: string;
  auto_start?: boolean;
  auto_restart?: boolean;
  start_params?: string;
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
}

export interface ServerConfigResponse {
  content: string;
  value: unknown;
  missing?: boolean;
}

export const api = {
  me: () => request<Me>("/api/me"),
  login: (password: string) =>
    request<{ ok: boolean; csrf?: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    request<{ ok: boolean }>("/api/password", {
      method: "PUT",
      body: JSON.stringify({ current, new: next }),
    }),

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
  saveSettings: (settings: {
    auto_start: boolean;
    auto_restart: boolean;
    start_params: string;
  }) =>
    request<Settings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  consoleHistory: (limit = 500) =>
    request<{ lines: ConsoleLine[] }>(`/api/console/history?limit=${limit}`),

  serverConfig: () => request<ServerConfigResponse>("/api/serverconfig"),
};

export function consoleStream(): EventSource {
  return new EventSource("/api/console/stream");
}
