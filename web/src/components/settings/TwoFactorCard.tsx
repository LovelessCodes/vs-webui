import { Check, Copy, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe, useTotpDisable, useTotpEnable, useTotpSetup } from "@/hooks/use-api";
import { errorMessage } from "@/lib/format";

/** Two-factor (TOTP) setup, recovery codes and disable flow. */
export default function TwoFactorCard() {
  const { t } = useTranslation();
  const me = useMe();
  const setup = useTotpSetup();
  const enable = useTotpEnable();
  const disable = useTotpDisable();

  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [copied, setCopied] = useState<"secret" | "codes" | null>(null);

  const enabled = me.data?.user?.totp_enabled ?? false;
  const error = setup.error ?? enable.error ?? disable.error;

  async function startSetup() {
    setCopied(null);
    setDisableCode("");
    setDisabling(false);
    const data = await setup.mutateAsync();
    setSecret(data.secret);
    setCode("");
    setRecoveryCodes(null);
    const QRCode = (await import("qrcode")).default;
    setQr(await QRCode.toDataURL(data.url, { width: 176, margin: 1 }));
  }

  function cancelSetup() {
    setQr(null);
    setSecret(null);
    setCode("");
  }

  function copy(text: string, which: "secret" | "codes") {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? (
            <ShieldCheck className="size-4 text-success" />
          ) : (
            <ShieldOff className="size-4 text-muted-foreground" />
          )}
          {t("settings.totpTitle")}
        </CardTitle>
        <CardDescription>{t("settings.totpDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error && <p className="text-error text-xs">{errorMessage(error)}</p>}

        {recoveryCodes ? (
          <div className="grid gap-3 border border-success/40 bg-success/5 p-3">
            <p className="text-xs text-success">{t("settings.totpRecoveryTitle")}</p>
            <p className="text-[11px] text-muted-foreground">{t("settings.totpRecoveryHint")}</p>
            <div className="grid grid-cols-2 gap-1 font-mono text-[11px]">
              {recoveryCodes.map((recovery) => (
                <span key={recovery}>{recovery}</span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => copy(recoveryCodes.join("\n"), "codes")}
                size="sm"
                variant="outline"
              >
                {copied === "codes" ? <Check /> : <Copy />}
                {copied === "codes" ? t("settings.totpCopied") : t("settings.totpCopyCodes")}
              </Button>
              <Button onClick={() => setRecoveryCodes(null)} size="sm" variant="ghost">
                {t("common.clear")}
              </Button>
            </div>
          </div>
        ) : qr ? (
          <div className="grid gap-3">
            <p className="text-[11px] text-muted-foreground">{t("settings.totpScanHint")}</p>
            <div className="flex flex-wrap items-start gap-4">
              <img
                alt={t("settings.totpTitle")}
                className="border border-border bg-white p-2"
                height={176}
                src={qr}
                width={176}
              />
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Label>{t("settings.totpSecret")}</Label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate border border-border bg-input/40 px-2 py-1 font-mono text-[11px]">
                    {secret}
                  </code>
                  <Button
                    onClick={() => secret && copy(secret, "secret")}
                    size="icon-sm"
                    title={t("settings.totpCopySecret")}
                    variant="outline"
                  >
                    {copied === "secret" ? <Check /> : <Copy />}
                  </Button>
                </div>
                <Label htmlFor="totp-confirm">{t("settings.totpConfirm")}</Label>
                <Input
                  id="totp-confirm"
                  inputMode="numeric"
                  onChange={(event) => setCode(event.target.value)}
                  placeholder={t("login.totpPlaceholder")}
                  value={code}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={code.trim().length === 0 || enable.isPending}
                onClick={() =>
                  enable.mutate(code.trim(), {
                    onSuccess: (data) => {
                      setRecoveryCodes(data.recovery_codes);
                      cancelSetup();
                    },
                  })
                }
                size="sm"
                variant="accent-primary"
              >
                {enable.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                {t("settings.totpEnable")}
              </Button>
              <Button onClick={cancelSetup} size="sm" variant="ghost">
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : enabled ? (
          <div className="grid gap-3">
            <Badge className="w-fit" variant="success">
              {t("settings.totpEnabled")}
            </Badge>
            {disabling ? (
              <div className="grid gap-2">
                <Label htmlFor="totp-disable">{t("settings.totpDisableConfirm")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    className="max-w-40"
                    id="totp-disable"
                    inputMode="numeric"
                    onChange={(event) => setDisableCode(event.target.value)}
                    placeholder={t("login.totpPlaceholder")}
                    value={disableCode}
                  />
                  <Button
                    disabled={disableCode.trim().length === 0 || disable.isPending}
                    onClick={() =>
                      disable.mutate(disableCode.trim(), {
                        onSuccess: () => {
                          setDisabling(false);
                          setDisableCode("");
                        },
                      })
                    }
                    size="sm"
                    variant="destructive"
                  >
                    {disable.isPending ? <Loader2 className="animate-spin" /> : <ShieldOff />}
                    {t("settings.totpDisable")}
                  </Button>
                  <Button onClick={() => setDisabling(false)} size="sm" variant="ghost">
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                className="w-fit"
                onClick={() => setDisabling(true)}
                size="sm"
                variant="outline"
              >
                <ShieldOff />
                {t("settings.totpDisable")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-[11px] text-muted-foreground">{t("settings.totpHint")}</p>
            <Button
              className="w-fit"
              disabled={setup.isPending}
              onClick={() => void startSetup()}
              size="sm"
              variant="accent-primary"
            >
              {setup.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              {t("settings.totpStart")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
