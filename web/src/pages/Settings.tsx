import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Loader2, ServerCog } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings, useStatus } from "@/hooks/use-api";
import { api, setCsrf } from "@/lib/api";
import { errorMessage } from "@/lib/format";

export default function Settings() {
  const queryClient = useQueryClient();
  const status = useStatus();
  const settings = useSettings();

  const [autoStart, setAutoStart] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [startParams, setStartParams] = useState("");
  const [saved, setSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setAutoStart(settings.data.auto_start ?? false);
      setAutoRestart(settings.data.auto_restart ?? false);
      setStartParams(settings.data.start_params ?? "");
    }
  }, [settings.data]);

  const saveSettings = useMutation({
    mutationFn: () => api.saveSettings({ auto_start: autoStart, auto_restart: autoRestart, start_params: startParams }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });

  const changePassword = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setPasswordChanged(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCsrf(null);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const passwordMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const canChangePassword =
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    (!status.data?.manager.auth_enabled || currentPassword.length > 0);

  function onSubmitPassword(event: FormEvent) {
    event.preventDefault();
    if (canChangePassword) changePassword.mutate();
  }

  return (
    <div className="grid h-full gap-4 overflow-y-auto pb-4 lg:grid-cols-2">
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="size-4 text-text-secondary" />
            Server behavior
          </CardTitle>
          <CardDescription>How the manager runs the game server.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-start">Start automatically on container boot</Label>
              <p className="text-text-muted text-[11px]">
                The manager starts the server as soon as it is up.
              </p>
            </div>
            <Switch checked={autoStart} id="auto-start" onCheckedChange={setAutoStart} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-restart">Restart after a crash</Label>
              <p className="text-text-muted text-[11px]">
                Up to five attempts with a 5 second delay, then it stays down.
              </p>
            </div>
            <Switch checked={autoRestart} id="auto-restart" onCheckedChange={setAutoRestart} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="start-params">Extra start arguments</Label>
            <Input
              id="start-params"
              onChange={(event) => setStartParams(event.target.value)}
              placeholder="e.g. --port 42421 --ip 0.0.0.0"
              value={startParams}
            />
            <p className="text-text-muted text-[11px]">
              Appended to the server command line; supports quoted values.
            </p>
          </div>

          {saveSettings.isError && (
            <p className="text-error text-xs">{errorMessage(saveSettings.error)}</p>
          )}

          <div className="flex items-center gap-3">
            <Button
              disabled={saveSettings.isPending || !settings.data}
              onClick={() => saveSettings.mutate()}
              variant="accent-primary"
            >
              {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              Save
            </Button>
            {saved && <span className="text-success text-xs">Saved</span>}
          </div>
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-text-secondary" />
            Web access
          </CardTitle>
          <CardDescription>
            {status.data?.manager.auth_enabled
              ? "Password protecting this web UI. Changing it signs out all sessions."
              : "Authentication is disabled (VS_WEB_AUTH=off)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {passwordChanged ? (
            <p className="text-success text-xs">
              Password changed. Sign in again with the new password.
            </p>
          ) : (
            <form className="grid gap-4" onSubmit={onSubmitPassword}>
              {status.data?.manager.auth_enabled && (
                <div className="grid gap-1.5">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    autoComplete="current-password"
                    id="current-password"
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    type="password"
                    value={currentPassword}
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  autoComplete="new-password"
                  id="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  value={newPassword}
                />
                {passwordTooShort && (
                  <p className="text-[11px] text-error">
                    At least 8 characters.
                  </p>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  autoComplete="new-password"
                  id="confirm-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  value={confirmPassword}
                />
                {passwordMismatch && (
                  <p className="text-[11px] text-error">Passwords do not match.</p>
                )}
              </div>

              {changePassword.isError && (
                <p className="text-error text-xs">{errorMessage(changePassword.error)}</p>
              )}

              <Button
                disabled={!canChangePassword || changePassword.isPending}
                type="submit"
                variant="accent-primary"
              >
                {changePassword.isPending && <Loader2 className="animate-spin" />}
                Change password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="self-start lg:col-span-2">
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-text-muted">Manager</span>
            <span className="font-mono">
              vs-webui {status.data?.manager.version ?? "?"}
            </span>
          </div>
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-text-muted">Data directory</span>
            <span className="truncate font-mono">{status.data?.manager.data_dir ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-text-muted">Game data path</span>
            <span className="truncate font-mono">
              {status.data?.manager.data_dir ?? "/data"}/server
            </span>
          </div>
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-text-muted">Game port</span>
            <span className="font-mono">{status.data?.config?.port ?? 42420}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
