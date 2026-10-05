import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import CodeEditor from "@/components/config/CodeEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSaveServerConfig, useServerConfig } from "@/hooks/use-api";
import type { JSONValue } from "@/components/config/json-utils";
import { errorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Field {
  key: string;
  label: string;
  kind: "string" | "number" | "boolean";
  hint?: string;
}

const FIELDS: Field[] = [
  { key: "ServerName", label: "Server name", kind: "string" },
  { key: "ServerDescription", label: "Description", kind: "string" },
  { key: "WelcomeMessage", label: "Welcome message", kind: "string", hint: "{0} is the player name" },
  { key: "Port", label: "Game port", kind: "number" },
  { key: "MaxClients", label: "Max clients", kind: "number" },
  { key: "MaxClientsInQueue", label: "Max clients in queue", kind: "number" },
  { key: "Password", label: "Server password", kind: "string", hint: "Empty = no password" },
  { key: "MaxChunkRadius", label: "Max chunk radius", kind: "number" },
  { key: "ServerLanguage", label: "Server language", kind: "string" },
  { key: "OnlyWhitelisted", label: "Whitelist only", kind: "boolean" },
  { key: "VerifyPlayerAuth", label: "Verify player auth", kind: "boolean" },
  { key: "AllowPvP", label: "Allow PvP", kind: "boolean" },
  { key: "AllowFireSpread", label: "Allow fire spread", kind: "boolean" },
  { key: "AdvertiseServer", label: "Advertise on public server list", kind: "boolean" },
  { key: "Upnp", label: "UPnP port forwarding", kind: "boolean" },
  { key: "PassTimeWhenEmpty", label: "Pass time when empty", kind: "boolean" },
];

type Mode = "form" | "json";

/**
 * serverconfig.json editor: a curated form over the keys servers touch most,
 * plus the full raw JSON. The game owns this file — we only merge edits back.
 */
export default function ServerConfigForm() {
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
    return original?.[field.key] ?? (field.kind === "boolean" ? false : field.kind === "number" ? 0 : "");
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
      <div className="flex items-center gap-2 p-4 text-xs text-text-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading server config…
      </div>
    );
  }

  const data = config.data;
  if (!data || data.missing || !original) {
    return (
      <p className="p-4 text-xs text-text-secondary">
        The server writes <span className="font-mono">serverconfig.json</span> on its first
        start. Start the server once, then edit it here.
      </p>
    );
  }

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex border border-border-default">
          {(["form", "json"] as const).map((option) => (
            <button
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                mode === option
                  ? "bg-accent-primary text-white"
                  : "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary",
              )}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {option === "form" ? "Form" : "Raw JSON"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {save.isError && <p className="text-error text-xs">{errorMessage(save.error)}</p>}
        {savedAt && !dirty && !save.isPending && (
          <span className="text-success text-xs">
            Saved{save.data?.restart_required ? " — restart to apply" : ""}
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
              Reset
            </Button>
            <Button
              disabled={!dirty || save.isPending}
              onClick={saveForm}
              size="sm"
              variant="accent-primary"
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save changes
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
                    <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
                    {field.hint && (
                      <p className="text-[11px] text-text-muted">{field.hint}</p>
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
                <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
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
                {field.hint && <p className="text-[11px] text-text-muted">{field.hint}</p>}
              </div>
            );
          })}
          <p className="text-[11px] text-text-muted lg:col-span-2">
            Only the fields you changed are merged into the file — the rest of the config is
            left untouched. Use Raw JSON for roles, world config and the remaining keys.
          </p>
        </div>
      ) : (
        <div className="h-[480px] border border-border-default">
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
