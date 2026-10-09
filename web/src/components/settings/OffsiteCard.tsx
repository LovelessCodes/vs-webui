import { CloudUpload, Loader2, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-api";
import { api } from "@/lib/api";
import type { OffsiteConfig } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { toast } from "@/lib/notify";

/** Mirrors finished backups to WebDAV or S3-compatible storage. */
export default function OffsiteCard() {
  const { t } = useTranslation();
  const settings = useSettings();
  const [kind, setKind] = useState<"webdav" | "s3">("webdav");
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [prefix, setPrefix] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const config = settings.data?.offsite;
    if (!config) return;
    setKind(config.kind === "s3" ? "s3" : "webdav");
    setUrl(config.url ?? "");
    setUser(config.user ?? "");
    setPassword(config.password ?? "");
    setBucket(config.bucket ?? "");
    setRegion(config.region ?? "");
    setAccessKey(config.access_key ?? "");
    setSecretKey(config.secret_key ?? "");
    setPrefix(config.prefix ?? "");
  }, [settings.data]);

  const configured = Boolean(settings.data?.offsite);

  function payload(): OffsiteConfig {
    return {
      kind,
      url,
      user,
      password,
      bucket,
      region,
      access_key: accessKey,
      secret_key: secretKey,
      prefix,
    };
  }

  async function save(config: OffsiteConfig | null) {
    setSaving(true);
    setError(null);
    try {
      await api.saveSettings({ offsite: config });
      toast.success(t("common.saved"));
      await settings.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError : new Error(String(saveError)));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setError(null);
    try {
      await api.testOffsite();
      toast.success(t("settings.offsiteTestOk"));
    } catch (testError) {
      toast.error(
        t("settings.offsiteTestFailed", { message: errorMessage(testError) }),
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="self-start lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CloudUpload className="size-4 text-muted-foreground" />
            {t("settings.offsiteTitle")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              disabled={!configured || testing}
              onClick={() => void test()}
              size="sm"
              variant="outline"
            >
              {testing ? <Loader2 className="animate-spin" /> : <Send />}
              {t("settings.offsiteTest")}
            </Button>
            {configured && (
              <Button
                disabled={saving}
                onClick={() => void save(null)}
                size="sm"
                variant="outline"
              >
                <Trash2 />
                {t("settings.offsiteRemove")}
              </Button>
            )}
            <Button
              disabled={saving || !url.trim()}
              onClick={() => void save(payload())}
              size="sm"
              variant="accent-primary"
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {t("common.save")}
            </Button>
          </div>
        </div>
        <CardDescription>{t("settings.offsiteDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label>{t("settings.offsiteKind")}</Label>
          <Select
            items={[
              { value: "webdav", label: t("settings.offsiteKindWebdav") },
              { value: "s3", label: t("settings.offsiteKindS3") },
            ]}
            onValueChange={(value) => {
              if (value === "webdav" || value === "s3") setKind(value);
            }}
            value={kind}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="webdav">{t("settings.offsiteKindWebdav")}</SelectItem>
              <SelectItem value="s3">{t("settings.offsiteKindS3")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="offsite-url">{t("settings.offsiteUrl")}</Label>
          <Input
            id="offsite-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder={
              kind === "s3"
                ? t("settings.offsiteUrlPlaceholderS3")
                : t("settings.offsiteUrlPlaceholderWebdav")
            }
            value={url}
          />
        </div>

        {kind === "webdav" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="offsite-user">{t("settings.offsiteUser")}</Label>
              <Input
                autoComplete="off"
                id="offsite-user"
                onChange={(event) => setUser(event.target.value)}
                value={user}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="offsite-password">{t("settings.offsitePassword")}</Label>
              <Input
                autoComplete="new-password"
                id="offsite-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="offsite-bucket">{t("settings.offsiteBucket")}</Label>
              <Input
                id="offsite-bucket"
                onChange={(event) => setBucket(event.target.value)}
                value={bucket}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="offsite-region">{t("settings.offsiteRegion")}</Label>
              <Input
                id="offsite-region"
                onChange={(event) => setRegion(event.target.value)}
                placeholder="us-east-1"
                value={region}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="offsite-access">{t("settings.offsiteAccessKey")}</Label>
              <Input
                autoComplete="off"
                id="offsite-access"
                onChange={(event) => setAccessKey(event.target.value)}
                value={accessKey}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="offsite-secret">{t("settings.offsiteSecretKey")}</Label>
              <Input
                autoComplete="new-password"
                id="offsite-secret"
                onChange={(event) => setSecretKey(event.target.value)}
                type="password"
                value={secretKey}
              />
            </div>
          </div>
        )}

        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="offsite-prefix">{t("settings.offsitePrefix")}</Label>
          <Input
            id="offsite-prefix"
            onChange={(event) => setPrefix(event.target.value)}
            placeholder="vs-webui"
            value={prefix}
          />
          <p className="text-[11px] text-muted-foreground">{t("settings.offsitePrefixHint")}</p>
        </div>

        <p className="text-[11px] text-muted-foreground">{t("settings.offsiteHint")}</p>
        {error && <p className="text-error text-xs">{errorMessage(error)}</p>}
      </CardContent>
    </Card>
  );
}
