import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, setCsrf } from "@/lib/api";
import { errorMessage } from "@/lib/format";

export default function Login() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: (data) => {
      if (data.csrf) setCsrf(data.csrf);
      setPassword("");
      void queryClient.invalidateQueries();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length > 0) login.mutate();
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg-primary p-6">
      <div className="w-full max-w-sm border border-border-default bg-bg-card">
        <div className="flex flex-col items-center gap-2 border-b border-border-subtle px-6 py-8">
          <div className="flex size-10 items-center justify-center border border-accent-primary/40 bg-accent-primary/10">
            <Lock className="size-5 text-accent-primary" />
          </div>
          <h1 className="text-base font-bold tracking-wide">VS WEBUI</h1>
          <p className="text-text-secondary text-xs">Vintage Story server manager</p>
        </div>

        <form className="grid gap-4 p-6" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              autoFocus
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Web UI password"
              type="password"
              value={password}
            />
          </div>

          {login.isError && (
            <p className="text-error text-xs">{errorMessage(login.error)}</p>
          )}

          <Button
            className="w-full"
            disabled={password.length === 0 || login.isPending}
            type="submit"
            variant="accent-primary"
          >
            {login.isPending && <Loader2 className="animate-spin" />}
            Sign in
          </Button>

          <p className="text-text-muted text-[11px] leading-relaxed">
            The password is set with the <span className="font-mono">VS_WEB_PASSWORD</span>{" "}
            environment variable, or generated on first boot and printed to the container logs.
          </p>
        </form>
      </div>
    </div>
  );
}
