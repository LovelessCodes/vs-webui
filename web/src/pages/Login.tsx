import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, setCsrf } from "@/lib/api";
import { errorMessage } from "@/lib/format";

export default function Login() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpStep, setTotpStep] = useState(false);

  const login = useMutation({
    mutationFn: () => api.login(username.trim(), password, code.trim() || undefined),
    onSuccess: (data) => {
      if (data.totp_required) {
        setTotpStep(true);
        return;
      }
      if (data.csrf) setCsrf(data.csrf);
      setPassword("");
      setCode("");
      void queryClient.invalidateQueries();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length > 0 && (!totpStep || code.trim().length > 0)) login.mutate();
  }

  return (
    <main className="flex h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm border border-border bg-card">
        <div className="flex flex-col items-center gap-2 border-b border-border px-6 py-8">
          <div className="flex size-10 items-center justify-center border border-accent-primary/40 bg-accent-primary/10">
            <Lock className="size-5 text-accent-primary" />
          </div>
          <h1 className="text-base font-bold tracking-wide">{t("brand.name")}</h1>
          <p className="text-muted-foreground text-xs">{t("login.subtitle")}</p>
        </div>

        <form className="grid gap-4 p-6" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="username">{t("login.username")}</Label>
            <Input
              autoComplete="username"
              autoFocus
              id="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t("login.usernamePlaceholder")}
              value={username}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="password">{t("login.password")}</Label>
            <Input
              autoComplete="current-password"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("login.placeholder")}
              type="password"
              value={password}
            />
          </div>

          {totpStep && (
            <div className="grid gap-1.5">
              <Label htmlFor="totp-code">{t("login.totpCode")}</Label>
              <Input
                autoComplete="one-time-code"
                autoFocus
                id="totp-code"
                inputMode="numeric"
                onChange={(event) => setCode(event.target.value)}
                placeholder={t("login.totpPlaceholder")}
                value={code}
              />
              <p className="text-[11px] text-muted-foreground">{t("login.totpHint")}</p>
            </div>
          )}

          {login.isError && <p className="text-error text-xs">{errorMessage(login.error)}</p>}

          <Button
            className="w-full"
            disabled={
              password.length === 0 || (totpStep && code.trim().length === 0) || login.isPending
            }
            type="submit"
            variant="accent-primary"
          >
            {login.isPending && <Loader2 className="animate-spin" />}
            {t("login.signIn")}
          </Button>

          <p className="text-muted-foreground text-[11px] leading-relaxed">{t("login.hint")}</p>
        </form>
      </div>
    </main>
  );
}
