import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import CodeEditor from "@/components/config/CodeEditor";
import type { JSONValue } from "@/components/config/json-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSaveServerConfig, useServerConfig } from "@/hooks/use-api";
import { errorMessage } from "@/lib/format";
import { cn } from "cn";

interface Field {
  key: string;
  labelKey: string;
  kind: "string" | "number" | "boolean";
  hintKey?: string;
}

const FIELDS: Field[] = [
  { key: "ServerName", labelKey: "settings.fieldName", kind: "string" },
  { key: "ServerDescription", labelKey: "settings.fieldDescription", kind: "string" },
  {
    key: "WelcomeMessage",
    labelKey: "settings.fieldWelcome",
    kind: "string",
    hintKey: "settings.fieldWelcomeHint",
  },
  { key: "Port", labelKey: "settings.fieldPort", kind: "number" },
  { key: "MaxClients", labelKey: "settings.fieldMaxClients", kind: "number" },
  { key: "MaxClientsInQueue", labelKey: "settings.fieldMaxQueue", kind: "number" },
  {
    key: "Password",
    labelKey: "settings.fieldPassword",
    kind: "string",
    hintKey: "settings.fieldPasswordHint",
  },
  { key: "MaxChunkRadius", labelKey: "settings.fieldChunkRadius", kind: "number" },
  { key: "ServerLanguage", labelKey: "settings.fieldLanguage", kind: "string" },
  { key: "OnlyWhitelisted", labelKey: "settings.fieldWhitelistOnly", kind: "boolean" },
  { key: "VerifyPlayerAuth", labelKey: "settings.fieldVerifyAuth", kind: "boolean" },
  { key: "AllowPvP", labelKey: "settings.fieldPvp", kind: "boolean" },
  { key: "AllowFireSpread", labelKey: "settings.fieldFire", kind: "boolean" },
  { key: "AdvertiseServer", labelKey: "settings.fieldAdvertise", kind: "boolean" },
  { key: "Upnp", labelKey: "settings.fieldUpnp", kind: "boolean" },
  { key: "PassTimeWhenEmpty", labelKey: "settings.fieldPassTime", kind: "boolean" },
];

type Mode = "form" | "json";

/**
 * serverconfig.json editor: a curated form over the keys servers touch most,
 * plus the full raw JSON. The game owns this file — we only merge edits back.
 */
export default function ServerConfigForm() {
  const { t } = useTranslation();
  const config = useServerConfig();
  const save = useSaveServerConfig();
  const [mode, setMode] = useState<Mode>("form");
  const [overrides, setOverrides] = useState<Record<string, JSONValue>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const original = useMemo(() => {
    const value = config.data?.value;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, JSONValue>)
      : null;
  }, [config.data]);

  const dirty = Object.keys(overrides).length > 0;

  function valueOf(field: Field): JSONValue {
    if (field.key in overrides) return overrides[field.key];
    return (
      original?.[field.key] ?? (field.kind === "boolean" ? false : field.kind === "number" ? 0 : "")
    );
  }

  function setField(field: Field, value: JSONValue) {
    setOverrides((current) => ({ ...current, [field.key]: value }));
  }

  function saveForm() {
    if (!original) return;
    const merged = { ...original, ...overrides };
    save.mutate(JSON.stringify(merged, null, 2), {
      onSuccess: () => {
        setOverrides({});
        setSavedAt(Date.now());
      },
    });
  }

  if (config.isLoading && !config.data) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("settings.loadingConfig")}
      </div>
    );
  }

  const data = config.data;
  if (!data || data.missing || !original) {
    return <p className="p-4 text-xs text-muted-foreground">{t("settings.missingConfig")}</p>;
  }

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex border border-border">
          {(["form", "json"] as const).map((option) => (
            <button
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                mode === option
                  ? "bg-accent-strong text-white"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {option === "form" ? t("settings.form") : t("settings.rawJson")}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {save.isError && <p className="text-error text-xs">{errorMessage(save.error)}</p>}
        {savedAt && !dirty && !save.isPending && (
          <span className="text-success text-xs">
            {save.data?.restart_required ? t("configs.savedRestart") : t("common.saved")}
          </span>
        )}
        {mode === "form" && (
          <>
            <Button
              disabled={!dirty}
              onClick={() => setOverrides({})}
              size="sm"
              variant="outline"
            >
              {t("common.reset")}
            </Button>
            <Button
              disabled={!dirty || save.isPending}
              onClick={saveForm}
              size="sm"
              variant="accent-primary"
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("settings.saveChanges")}
            </Button>
          </>
        )}
      </div>

      {mode === "form" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {FIELDS.map((field) => {
            const value = valueOf(field);
            if (field.kind === "boolean") {
              return (
                <div className="flex items-center justify-between gap-4" key={field.key}>
                  <div>
                    <Label htmlFor={`field-${field.key}`}>{t(field.labelKey)}</Label>
                    {field.hintKey && (
                      <p className="text-[11px] text-muted-foreground">{t(field.hintKey)}</p>
                    )}
                  </div>
                  <Switch
                    checked={value === true}
                    id={`field-${field.key}`}
                    onCheckedChange={(checked) => setField(field, checked)}
                  />
                </div>
              );
            }
            return (
              <div className="grid gap-1.5" key={field.key}>
                <Label htmlFor={`field-${field.key}`}>{t(field.labelKey)}</Label>
                <Input
                  id={`field-${field.key}`}
                  onChange={(event) =>
                    setField(
                      field,
                      field.kind === "number"
                        ? Number(event.target.value) || 0
                        : event.target.value,
                    )
                  }
                  type={field.kind === "number" ? "number" : "text"}
                  value={value === null ? "" : String(value)}
                />
                {field.hintKey && (
                  <p className="text-[11px] text-muted-foreground">{t(field.hintKey)}</p>
                )}
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground lg:col-span-2">{t("settings.formNote")}</p>
        </div>
      ) : (
        <div className="h-[480px] border border-border">
          <CodeEditor
            code={data.content}
            file="serverconfig.json"
            key={data.content}
            onSave={({ newCode }) =>
              save.mutate(newCode, { onSuccess: () => setSavedAt(Date.now()) })
            }
          />
        </div>
      )}
    </div>
  );
}
