import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api, setCsrf } from "@/lib/api";
import { errorMessage } from "@/lib/format";

/** Password drawer used from the guest page. */
export default function SignInSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => api.login(username.trim(), password),
    onSuccess: (data) => {
      if (data.csrf) setCsrf(data.csrf);
      setPassword("");
      onOpenChange(false);
      void queryClient.invalidateQueries();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length > 0) login.mutate();
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-sm" side="right">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t("login.signIn")}</SheetTitle>
          <SheetDescription>{t("login.subtitle")}</SheetDescription>
        </SheetHeader>
        <form className="grid gap-4 p-4" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="guest-username">{t("login.username")}</Label>
            <Input
              autoComplete="username"
              id="guest-username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t("login.usernamePlaceholder")}
              value={username}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="guest-password">{t("login.password")}</Label>
            <Input
              autoComplete="current-password"
              autoFocus
              id="guest-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("login.placeholder")}
              type="password"
              value={password}
            />
          </div>

          {login.isError && <p className="text-error text-xs">{errorMessage(login.error)}</p>}

          <Button
            disabled={password.length === 0 || login.isPending}
            type="submit"
            variant="accent-primary"
          >
            {login.isPending && <Loader2 className="animate-spin" />}
            {t("login.signIn")}
          </Button>

          <p className="text-muted-foreground text-[11px] leading-relaxed">{t("login.hint")}</p>
        </form>
      </SheetContent>
    </Sheet>
  );
}
