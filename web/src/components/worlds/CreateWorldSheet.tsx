import { ChevronDown, Globe2, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCreateWorld } from "@/hooks/use-api";
import { errorMessage } from "@/lib/format";

const PLAY_STYLES = [
  "surviveandbuild",
  "exploration",
  "wildernesssurvival",
  "homosapiens",
  "creativebuilding",
] as const;

const WORLD_TYPES = ["standard", "superflat"] as const;

const DEFAULT = "default";

interface SelectField {
  key: string;
  labelKey: string;
  options: readonly string[];
}

const GENERATION_SELECTS: SelectField[] = [
  {
    key: "startingClimate",
    labelKey: "worlds.fieldStartingClimate",
    options: ["hot", "warm", "temperate", "cool", "icy"],
  },
  {
    key: "seasons",
    labelKey: "worlds.fieldSeasons",
    options: ["enabled", "spring", "summer", "winter", "fall"],
  },
  {
    key: "temporalStorms",
    labelKey: "worlds.fieldTemporalStorms",
    options: ["off", "veryrare", "rare", "sometimes", "often", "veryoften"],
  },
  {
    key: "creatureHostility",
    labelKey: "worlds.fieldCreatureHostility",
    options: ["aggressive", "passive", "off"],
  },
  {
    key: "deathPunishment",
    labelKey: "worlds.fieldDeathPunishment",
    options: ["drop", "keep"],
  },
  {
    key: "worldClimate",
    labelKey: "worlds.fieldWorldClimate",
    options: ["realistic", "patchy"],
  },
  {
    key: "worldEdge",
    labelKey: "worlds.fieldWorldEdge",
    options: ["blocked", "traversable"],
  },
  {
    key: "allowLandClaiming",
    labelKey: "worlds.fieldAllowLandClaiming",
    options: ["true", "false"],
  },
  {
    key: "harshWinters",
    labelKey: "worlds.fieldHarshWinters",
    options: ["true", "false"],
  },
];

const GENERATION_NUMBERS: Array<{ key: string; labelKey: string; placeholder: string }> = [
  { key: "daysPerMonth", labelKey: "worlds.fieldDaysPerMonth", placeholder: "9" },
  { key: "worldWidth", labelKey: "worlds.fieldWorldWidth", placeholder: "1024000" },
  { key: "worldLength", labelKey: "worlds.fieldWorldLength", placeholder: "1024000" },
];

/** Creates a world by pre-seeding serverconfig.json; the server generates the
 * save on the next start. */
export default function CreateWorldSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateWorld();
  const [name, setName] = useState("");
  const [seed, setSeed] = useState("");
  const [playStyle, setPlayStyle] = useState<string>(PLAY_STYLES[0]);
  const [worldType, setWorldType] = useState<string>(WORLD_TYPES[0]);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const playStyleItems = PLAY_STYLES.map((style) => ({
    value: style,
    label: t(`worlds.playStyle.${style}`),
  }));
  const worldTypeItems = WORLD_TYPES.map((type) => ({
    value: type,
    label: t(`worlds.worldType.${type}`),
  }));

  const setOverride = (key: string, value: string) =>
    setOverrides((current) => {
      const next = { ...current };
      if (!value || value === DEFAULT) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });

  function reset() {
    setName("");
    setSeed("");
    setPlayStyle(PLAY_STYLES[0]);
    setWorldType(WORLD_TYPES[0]);
    setGenerationOpen(false);
    setOverrides({});
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const world_configuration = Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value),
    );
    create.mutate(
      {
        name: trimmed,
        seed: seed.trim() || undefined,
        play_style: playStyle,
        world_type: worldType,
        world_configuration: Object.keys(world_configuration).length
          ? world_configuration
          : undefined,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Sheet
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      open={open}
    >
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md" side="right">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Globe2 className="size-4 text-muted-foreground" />
            {t("worlds.createTitle")}
          </SheetTitle>
          <SheetDescription>{t("worlds.createDescription")}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <div className="grid gap-4 p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="world-name">{t("worlds.nameLabel")}</Label>
              <Input
                autoFocus
                id="world-name"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
                placeholder={t("worlds.namePlaceholder")}
                value={name}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="world-seed">{t("worlds.seedLabel")}</Label>
              <Input
                id="world-seed"
                onChange={(event) => setSeed(event.target.value)}
                placeholder={t("worlds.seedPlaceholder")}
                value={seed}
              />
              <p className="text-[11px] text-muted-foreground">{t("worlds.seedHint")}</p>
            </div>

            <div className="grid gap-1.5">
              <Label>{t("worlds.playStyleLabel")}</Label>
              <Select
                items={playStyleItems}
                onValueChange={(value) => {
                  if (typeof value === "string") setPlayStyle(value);
                }}
                value={playStyle}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {playStyleItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>{t("worlds.worldTypeLabel")}</Label>
              <Select
                items={worldTypeItems}
                onValueChange={(value) => {
                  if (typeof value === "string") setWorldType(value);
                }}
                value={worldType}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {worldTypeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border border-border">
              <button
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted/40"
                onClick={() => setGenerationOpen((current) => !current)}
                type="button"
              >
                {t("worlds.generationTitle")}
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${generationOpen ? "rotate-180" : ""}`}
                />
              </button>
              {generationOpen && (
                <div className="grid gap-3 border-t border-border p-3">
                  <p className="text-[11px] text-muted-foreground">
                    {t("worlds.generationHint")}
                  </p>
                  {GENERATION_SELECTS.map((field) => (
                    <div className="grid gap-1.5" key={field.key}>
                      <Label>{t(field.labelKey)}</Label>
                      <Select
                        items={[
                          { value: DEFAULT, label: t("worlds.fieldDefault") },
                          ...field.options.map((option) => ({ value: option, label: option })),
                        ]}
                        onValueChange={(value) => {
                          if (typeof value === "string") setOverride(field.key, value);
                        }}
                        value={overrides[field.key] ?? DEFAULT}
                      >
                        <SelectTrigger className="w-full capitalize">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectItem value={DEFAULT}>{t("worlds.fieldDefault")}</SelectItem>
                          {field.options.map((option) => (
                            <SelectItem className="capitalize" key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  {GENERATION_NUMBERS.map((field) => (
                    <div className="grid gap-1.5" key={field.key}>
                      <Label htmlFor={`world-${field.key}`}>{t(field.labelKey)}</Label>
                      <Input
                        id={`world-${field.key}`}
                        inputMode="numeric"
                        onChange={(event) => {
                          const value = event.target.value.replace(/[^0-9]/g, "");
                          setOverride(field.key, value);
                        }}
                        placeholder={field.placeholder}
                        value={overrides[field.key] ?? ""}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">{t("worlds.createHint")}</p>

            {create.isError && (
              <p className="text-xs text-error">{errorMessage(create.error)}</p>
            )}

            <Button
              disabled={!name.trim() || create.isPending}
              onClick={submit}
              variant="accent-primary"
            >
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("worlds.createButton")}
            </Button>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
