import { Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ListSkeleton } from "@/components/common/LoadingSkeleton";
import VirtualList from "@/components/common/VirtualList";
import { BrokenModsBanner, MissingDepsBanner } from "@/components/mods/banners";
import InstalledModRow from "@/components/mods/InstalledModRow";
import ModBrowseRow from "@/components/mods/ModBrowseRow";
import ModDetailSheet from "@/components/mods/ModDetailSheet";
import VersionPickerSheet from "@/components/mods/VersionPickerSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useInstalledMods,
  useInstallMod,
  useModDb,
  useModJobs,
  useModTags,
  useModUpdates,
  usePinMod,
  useRemoveMod,
  useStatus,
  useUpdateAllMods,
  useUpdateMod,
} from "@/hooks/use-api";
import type { InstalledMod, ModSummary, ModUpdate } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { findMissingDependencies } from "@/lib/version";

type Tab = "browse" | "installed";
type Side = "any" | "server" | "client";
type SortBy = "downloads" | "trending" | "name" | "recent";

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function sortMods(mods: ModSummary[], sort: SortBy): ModSummary[] {
  const list = [...mods];
  switch (sort) {
    case "downloads":
      list.sort((a, b) => b.downloads - a.downloads);
      break;
    case "trending":
      list.sort((a, b) => b.trendingpoints - a.trendingpoints);
      break;
    case "name":
      list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      break;
    case "recent":
      list.sort((a, b) => (b.lastreleased ?? "").localeCompare(a.lastreleased ?? ""));
      break;
  }
  return list;
}

function installedVersionOf(
  mod: ModSummary | null,
  installed: InstalledMod[] | undefined,
): string | undefined {
  return installedModOf(mod, installed)?.version;
}

function installedModOf(
  mod: ModSummary | null,
  installed: InstalledMod[] | undefined,
): InstalledMod | undefined {
  if (!mod || !installed) return undefined;
  const ids = new Set(mod.modidstrs.map((id) => id.toLowerCase()));
  if (mod.urlalias) ids.add(mod.urlalias.toLowerCase());
  return installed.find((entry) => ids.has(entry.modid.toLowerCase()));
}

function updateOf(
  mod: ModSummary,
  updates: Record<string, ModUpdate> | undefined,
): ModUpdate | undefined {
  if (!updates) return undefined;
  return mod.modidstrs.map((id) => updates[id.toLowerCase()]).find(Boolean);
}

export default function Mods() {
  const { t } = useTranslation();
  const status = useStatus();
  const activeVersion = status.data?.settings.version ?? undefined;

  const [tab, setTab] = useState<Tab>("browse");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  const [side, setSide] = useState<Side>("any");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<SortBy>("downloads");
  const [detailMod, setDetailMod] = useState<ModSummary | null>(null);
  const [versionPicker, setVersionPicker] = useState<InstalledMod | null>(null);

  const versionFilter = compatibleOnly ? activeVersion : undefined;
  const modb = useModDb(versionFilter, debouncedSearch, tab === "browse");
  const tags = useModTags(tab === "browse");
  const installed = useInstalledMods();
  const updates = useModUpdates();
  const jobs = useModJobs();

  const install = useInstallMod();
  const remove = useRemoveMod();
  const update = useUpdateMod();
  const updateAll = useUpdateAllMods();
  const pin = usePinMod();

  const pinned = useMemo(
    () => new Set((status.data?.settings.pinned_mods ?? []).map((id) => id.toLowerCase())),
    [status.data],
  );
  const installedMods = installed.data?.mods;
  const missing = useMemo(
    () => findMissingDependencies(installed.data?.mods),
    [installed.data],
  );
  const updateMap = updates.data?.updates ?? {};
  const updateCount = Object.keys(updateMap).length;
  const activeJobs = (jobs.data?.jobs ?? []).filter(
    (job) => job.status === "queued" || job.status === "running",
  );

  const filtered = useMemo(() => {
    let list = modb.data?.mods ?? [];
    if (side !== "any") {
      list = list.filter((mod) => mod.side === side || mod.side === "both");
    }
    if (tag) {
      list = list.filter((mod) => mod.tags.includes(tag));
    }
    return sortMods(list, sort);
  }, [modb.data, side, tag, sort]);

  const tagNames = useMemo(
    () => [...new Set((tags.data?.tags ?? []).map((entry) => entry.name))].sort(),
    [tags.data],
  );
  const tagColorMap = useMemo(
    () =>
      Object.fromEntries((tags.data?.tags ?? []).map((entry) => [entry.name, entry.color])),
    [tags.data],
  );

  const mutationError =
    install.error ?? update.error ?? remove.error ?? updateAll.error ?? pin.error;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          onValueChange={(value) => {
            const next = value[0];
            if (next === "browse" || next === "installed") setTab(next);
          }}
          size="sm"
          value={[tab]}
          variant="outline"
        >
          <ToggleGroupItem value="browse">{t("mods.browse")}</ToggleGroupItem>
          <ToggleGroupItem value="installed">
            {t("mods.installed", { count: installed.data?.mods.length ?? 0 })}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex-1" />
        {tab === "installed" && (
          <>
            <Button
              disabled={updateCount === 0 || updateAll.isPending}
              onClick={() => updateAll.mutate()}
              size="sm"
              variant={updateCount > 0 ? "accent-primary" : "outline"}
            >
              {updateAll.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("mods.updateAll")}
              {updateCount > 0 ? ` (${updateCount})` : ""}
            </Button>
            <Button
              disabled={installed.isFetching || updates.isFetching}
              onClick={() => {
                void installed.refetch();
                void updates.refetch();
              }}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={installed.isFetching ? "animate-spin" : undefined} />
              {t("common.refresh")}
            </Button>
          </>
        )}
      </div>

      {mutationError && (
        <p className="border border-error/40 bg-error/5 px-3 py-2 text-xs text-error">
          {errorMessage(mutationError)}
        </p>
      )}

      {tab === "browse" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-7"
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("mods.searchPlaceholder")}
                value={search}
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                checked={compatibleOnly}
                className="accent-[#8b5cf6]"
                disabled={!activeVersion}
                onChange={(event) => setCompatibleOnly(event.target.checked)}
                type="checkbox"
              />
              {activeVersion
                ? t("mods.compatibleWith", { version: activeVersion })
                : t("mods.noVersionSelected")}
            </label>
            <Select
              items={[
                { label: t("mods.anySide"), value: "any" },
                { label: t("mods.server"), value: "server" },
                { label: t("mods.client"), value: "client" },
              ]}
              onValueChange={(value) => {
                if (typeof value === "string") setSide(value as Side);
              }}
              value={side}
            >
              <SelectTrigger aria-label={t("mods.anySide")} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("mods.anySide")}</SelectItem>
                <SelectItem value="server">{t("mods.server")}</SelectItem>
                <SelectItem value="client">{t("mods.client")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              items={[
                { label: t("mods.allTags"), value: "" },
                ...tagNames.map((name) => ({ label: name, value: name })),
              ]}
              onValueChange={(value) => {
                if (typeof value === "string") setTag(value);
              }}
              value={tag}
            >
              <SelectTrigger aria-label={t("mods.allTags")} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("mods.allTags")}</SelectItem>
                {tagNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={[
                { label: t("mods.sortDownloads"), value: "downloads" },
                { label: t("mods.sortTrending"), value: "trending" },
                { label: t("mods.sortName"), value: "name" },
                { label: t("mods.sortRecent"), value: "recent" },
              ]}
              onValueChange={(value) => {
                if (typeof value === "string") setSort(value as SortBy);
              }}
              value={sort}
            >
              <SelectTrigger aria-label={t("mods.sortName")} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="downloads">{t("mods.sortDownloads")}</SelectItem>
                <SelectItem value="trending">{t("mods.sortTrending")}</SelectItem>
                <SelectItem value="name">{t("mods.sortName")}</SelectItem>
                <SelectItem value="recent">{t("mods.sortRecent")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {modb.isLoading && !modb.data && <ListSkeleton rows={6} />}
          {modb.isError && (
            <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
              {errorMessage(modb.error)}
            </p>
          )}

          {modb.data && (
            <>
              <p className="text-muted-foreground text-[11px]">
                {t("mods.count", { count: filtered.length })}
                {modb.isFetching ? ` · ${t("mods.updating")}` : ""}
              </p>
              <VirtualList
                empty={
                  <p className="p-6 text-center text-xs text-muted-foreground">
                    {t("mods.noMatch")}
                  </p>
                }
                estimateRowHeight={132}
                items={filtered}
                keyOf={(mod) => String(mod.modid)}
                renderItem={(mod) => {
                  const installedMod = installedModOf(mod, installedMods);
                  const updateEntry = updateOf(mod, updateMap);
                  return (
                    <ModBrowseRow
                      activeTag={tag}
                      installed={installedMod}
                      mod={mod}
                      onInstall={() => install.mutate({ modid: String(mod.modid), name: mod.name })}
                      onOpen={() => setDetailMod(mod)}
                      onTagClick={(name) => setTag((current) => (current === name ? "" : name))}
                      onUpdate={() =>
                        updateEntry &&
                        installedMod &&
                        update.mutate({
                          modid: installedMod.modid,
                          version: updateEntry.modversion,
                          file: installedMod.file,
                          name: installedMod.name,
                        })
                      }
                      tagColorMap={tagColorMap}
                      update={updateEntry}
                    />
                  );
                }}
                scrollButtonAlign="center"
              />
            </>
          )}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <BrokenModsBanner errors={installed.data?.errors ?? []} />
          <MissingDepsBanner missing={missing} />

          {installed.isLoading && !installed.data && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("mods.scanning")}
            </div>
          )}
          {installed.isError && (
            <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
              {errorMessage(installed.error)}
            </p>
          )}

          {installed.data && installed.data.mods.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 border border-dashed p-10 text-center">
              <p className="text-sm font-medium">{t("mods.noMods")}</p>
              <p className="text-muted-foreground text-xs">{t("mods.noModsHint")}</p>
              <Button onClick={() => setTab("browse")} size="sm" variant="accent-primary">
                {t("mods.browse")}
              </Button>
            </div>
          )}

          {installed.data && installed.data.mods.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col border border-border">
              <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                <span className="flex-1">{t("mods.installedHeader")}</span>
                {updateCount > 0 && (
                  <Badge variant="accent">{t("mods.updates", { count: updateCount })}</Badge>
                )}
              </div>
              <VirtualList
                estimateRowHeight={64}
                items={installed.data.mods}
                keyOf={(mod) => mod.file}
                renderItem={(mod) => {
                  const key = mod.modid.toLowerCase();
                  const pending = activeJobs.some((job) => job.modid.toLowerCase() === key);
                  return (
                    <InstalledModRow
                      mod={mod}
                      onPin={() => pin.mutate({ modid: mod.modid, pinned: !pinned.has(key) })}
                      onPickVersion={() => setVersionPicker(mod)}
                      onRemove={() => remove.mutate(mod.file)}
                      onUpdate={(version) =>
                        update.mutate({
                          modid: mod.modid,
                          version,
                          file: mod.file,
                          name: mod.name,
                        })
                      }
                      pending={pending}
                      pinned={pinned.has(key)}
                      update={updateMap[key]}
                    />
                  );
                }}
              />
            </div>
          )}
        </div>
      )}

      <ModDetailSheet
        installedVersion={installedVersionOf(detailMod, installed.data?.mods)}
        modid={detailMod ? String(detailMod.modid) : null}
        onClose={() => setDetailMod(null)}
      />
      <VersionPickerSheet mod={versionPicker} onClose={() => setVersionPicker(null)} />
    </div>
  );
}
