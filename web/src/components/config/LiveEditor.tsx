import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { deepSet, getAtPath, isObject, pathKey, safeInitialParse, type JSONValue } from "./json-utils";

type SaveParams = { file: string; newCode: string };

/**
 * Recursive live JSON editor with debounced auto-save. Edits are tracked
 * locally and only marked dirty by user input, so a query refetch cannot
 * schedule a save with stale content.
 */
export default function LiveEditor({
  code,
  file,
  onSave,
}: {
  code: string;
  file: string;
  onSave: (params: SaveParams) => void;
}) {
  const { t } = useTranslation();
  const [parseError, setParseError] = useState<string | null>(null);
  const [data, setData] = useState<JSONValue>(() => safeInitialParse(code, setParseError));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    if (!dirty || parseError) return;
    const timer = setTimeout(() => {
      onSaveRef.current({ file, newCode: JSON.stringify(data, null, 2) });
      setDirty(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [data, dirty, file, parseError]);

  function updateData(updater: (previous: JSONValue) => JSONValue) {
    setData(updater);
    setDirty(true);
  }

  function updateAtPath(path: (string | number)[], next: JSONValue) {
    updateData((previous) => deepSet(previous, path, next));
  }

  function handlePrimitiveChange(path: (string | number)[], raw: string, original: JSONValue) {
    let value: JSONValue = raw;
    if (typeof original === "number") {
      const number = Number(raw);
      value = Number.isNaN(number) ? 0 : number;
    } else if (original === null) {
      if (raw === "null") value = null;
      else if (raw === "true") value = true;
      else if (raw === "false") value = false;
      else if (raw.trim() !== "" && !Number.isNaN(Number(raw))) value = Number(raw);
    }
    updateAtPath(path, value);
  }

  function addArrayItem(path: (string | number)[]) {
    updateData((previous) => {
      const array = getAtPath(previous, path);
      if (!Array.isArray(array)) return previous;
      return deepSet(previous, path, [...array, ""]);
    });
  }

  function removeArrayItem(path: (string | number)[], index: number) {
    updateData((previous) => {
      const array = getAtPath(previous, path);
      if (!Array.isArray(array)) return previous;
      return deepSet(
        previous,
        path,
        array.filter((_, i) => i !== index),
      );
    });
  }

  function toggleCollapse(path: (string | number)[]) {
    const key = pathKey(path);
    setCollapsed((state) => ({ ...state, [key]: !state[key] }));
  }

  function renderValue(value: JSONValue, path: (string | number)[], keyLabel?: string | number) {
    const key = pathKey(path);

    if (Array.isArray(value)) {
      const isCollapsed = collapsed[key];
      return (
        <div className="grid gap-2" key={key}>
          <div className="flex items-center gap-2">
            <Button
              aria-expanded={!isCollapsed}
              onClick={() => toggleCollapse(path)}
              size="icon-xs"
              variant="outline"
            >
              {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            </Button>
            <span className="truncate font-mono text-xs">{keyLabel}</span>
            <span className="text-[10px] tracking-wide text-text-muted uppercase">[array]</span>
            <Button
              className="ml-auto"
              onClick={() => addArrayItem(path)}
              size="xs"
              variant="outline"
            >
              <Plus />
              {t("common.add")}
            </Button>
          </div>
          {!isCollapsed && (
            <div className="ml-3 grid gap-2 border-l border-border-subtle pl-3">
              {value.map((item, index) => (
                <div className="flex items-start gap-2" key={`${key}:${index}`}>
                  <div className="min-w-0 flex-1">{renderValue(item, [...path, index], index)}</div>
                  <Button
                    onClick={() => removeArrayItem(path, index)}
                    size="icon-xs"
                    variant="destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {value.length === 0 && (
                <p className="text-[11px] text-text-muted">{t("configs.emptyArray")}</p>
              )}
            </div>
          )}
        </div>
      );
    }

    if (isObject(value)) {
      const isCollapsed = collapsed[key];
      return (
        <div className="grid gap-2" key={key}>
          <div className="flex items-center gap-2">
            <Button
              aria-expanded={!isCollapsed}
              onClick={() => toggleCollapse(path)}
              size="icon-xs"
              variant="outline"
            >
              {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            </Button>
            <span className="truncate font-mono text-xs">{keyLabel}</span>
            <span className="text-[10px] tracking-wide text-text-muted uppercase">{"{ }"}</span>
          </div>
          {!isCollapsed && (
            <div className="ml-3 grid gap-2 border-l border-border-subtle pl-3">
              {Object.entries(value).map(([childKey, childValue]) =>
                renderValue(childValue, [...path, childKey], childKey),
              )}
            </div>
          )}
        </div>
      );
    }

    if (typeof value === "boolean") {
      return (
        <div className="flex items-center gap-3" key={key}>
          <label
            className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
            htmlFor={`bool-${key}`}
          >
            {keyLabel}
          </label>
          <Switch
            checked={value}
            id={`bool-${key}`}
            onCheckedChange={(checked) => updateAtPath(path, checked)}
          />
        </div>
      );
    }

    if (typeof value === "number") {
      return (
        <div className="flex items-center gap-3" key={key}>
          <label
            className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
            htmlFor={`num-${key}`}
          >
            {keyLabel}
          </label>
          <Input
            className="h-7 w-40 shrink-0 font-mono text-xs"
            id={`num-${key}`}
            onChange={(event) => handlePrimitiveChange(path, event.target.value, value)}
            type="number"
            value={value}
          />
        </div>
      );
    }

    return (
      <div className="flex items-center gap-3" key={key}>
        <label
          className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
          htmlFor={`str-${key}`}
        >
          {keyLabel}
        </label>
        <Input
          className="h-7 w-40 shrink-0 font-mono text-xs"
          id={`str-${key}`}
          onChange={(event) => handlePrimitiveChange(path, event.target.value, value)}
          value={value === null ? "null" : value}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4">
      {parseError && (
        <div className="border border-error/40 bg-error/10 p-2 text-[11px] text-error">
          {t("configs.parseError", { message: parseError })}
        </div>
      )}

      <p className="text-[10px] font-medium tracking-widest text-text-muted uppercase">
        {t("configs.liveEditor")} · {file}
      </p>

      {isObject(data) ? (
        <form className="grid gap-3" onSubmit={(event) => event.preventDefault()}>
          {Object.entries(data).map(([childKey, childValue]) =>
            renderValue(childValue, [childKey], childKey),
          )}
        </form>
      ) : Array.isArray(data) ? (
        <div className="grid gap-2">
          {data.map((value, index) => renderValue(value, [index], index))}
        </div>
      ) : (
        <p className="text-xs text-text-muted">{t("configs.rootPrimitive")}</p>
      )}

      <p className="text-right text-[11px] text-text-muted">{t("configs.autoSave")}</p>
    </div>
  );
}
