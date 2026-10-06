import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ListSkeleton } from "@/components/common/LoadingSkeleton";
import VirtualList from "@/components/common/VirtualList";
import InstalledModRow from "@/components/mods/InstalledModRow";
import ModBrowseRow from "@/components/mods/ModBrowseRow";
import ModDetailSheet from "@/components/mods/ModDetailSheet";
import ModFiltersBar from "@/components/mods/ModFiltersBar";
import VersionPickerSheet from "@/components/mods/VersionPickerSheet";
import { BrokenModsBanner, DuplicateModsBanner, MissingDepsBanner } from "@/components/mods/banners";
import { useModFilters } from "@/components/mods/use-mod-filters";
import {
  useFavoriteMod,
  useGameVersions,
  useInstalledMods,
  useInstallMod,
  useModDb,
  useModJobs,
  useModTags,
  useModUpdates,
  usePinMod,
  useRemoveMod,
  useStatus,
  useUpdateMod,
} from "@/hooks/use-api";
import type { InstalledMod, ModSummary, ModUpdate } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { compareMods } from "@/lib/mod-sort";
import { findMissingDependencies } from "@/lib/version";

type BrowserItem = { kind: "modb"; mod: ModSummary } | { kind: "local"; mod: InstalledMod };

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
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

/** Stable key for favorites, mirroring Story Forge (primary modidstr first). */
function favoriteKeyOf(mod: ModSummary): string {
  return (mod.modidstrs[0] ?? mod.urlalias ?? String(mod.modid)).toLowerCase();
}

function isFavorite(mod: ModSummary, favorites: Set<string>): boolean {
  const keys = mod.modidstrs.map((id) => id.toLowerCase());
  if (mod.urlalias) keys.push(mod.urlalias.toLowerCase());
  return keys.some((key) => favorites.has(key));
}

export default function Mods() {
  const { t } = useTranslation();
  const status = useStatus();
  const activeVersion = status.data?.settings.version ?? undefined;

  const filters = useModFilters(activeVersion);
  const debouncedSearch = useDebounced(filters.searchText);

  const modb = useModDb(filters.selectedGameVersions, debouncedSearch, status.isFetched);
  const gameVersionsQuery = useGameVersions();
  const tags = useModTags();
  const installed = useInstalledMods();
  const updates = useModUpdates();
  const jobs = useModJobs();

  const install = useInstallMod();
  const remove = useRemoveMod();
  const update = useUpdateMod();
  const pin = usePinMod();
  const favorite = useFavoriteMod();

  const [detailMod, setDetailMod] = useState<ModSummary | null>(null);
  const [versionPicker, setVersionPicker] = useState<InstalledMod | null>(null);

  const pinned = useMemo(
    () => new Set((status.data?.settings.pinned_mods ?? []).map((id) => id.toLowerCase())),
    [status.data],
  );
  const favorites = useMemo(
    () => new Set((status.data?.settings.favorite_mods ?? []).map((id) => id.toLowerCase())),
    [status.data],
  );
  const installedMods = installed.data?.mods;
  const missing = useMemo(
    () => findMissingDependencies(installed.data?.mods),
    [installed.data],
  );
  const duplicates = useMemo(() => {
    const byId = new Map<string, InstalledMod[]>();
    for (const mod of installed.data?.mods ?? []) {
      const key = mod.modid.toLowerCase();
      const existing = byId.get(key);
      if (existing) {
        existing.push(mod);
      } else {
        byId.set(key, [mod]);
      }
    }
    return [...byId.entries()]
      .filter(([, mods]) => mods.length > 1)
      .map(([modid, mods]) => ({ modid, mods }));
  }, [installed.data]);
  const updateMap = updates.data?.updates ?? {};
  const updateCount = Object.keys(updateMap).length;
  const activeJobs = (jobs.data?.jobs ?? []).filter(
    (job) => job.status === "queued" || job.status === "running",
  );

  const tagColorMap = useMemo(
    () =>
      Object.fromEntries((tags.data?.tags ?? []).map((entry) => [entry.name, entry.color])),
    [tags.data],
  );
  const tagByName = useMemo(
    () => new Map((tags.data?.tags ?? []).map((entry) => [entry.name, entry])),
    [tags.data],
  );

  const filtered = useMemo(() => {
    const mods = modb.data?.mods ?? [];
    const list = mods.filter((mod) => {
      if (
        filters.selectedModTags.length > 0 &&
        !filters.selectedModTags.every((tag) => mod.tags.includes(tag.name))
      ) {
        return false;
      }
      if (filters.author && !mod.author.toLowerCase().includes(filters.author.toLowerCase())) {
        return false;
      }
      // Only filter by category when side is not "installed" (Story Forge parity).
      if (filters.side !== "installed" && mod.type !== filters.category) return false;
      if (filters.favoritesOnly && !isFavorite(mod, favorites)) return false;
      if (filters.side === "installed") {
        if (!installedModOf(mod, installedMods)) return false;
      } else if (filters.side !== "any" && mod.side !== filters.side) {
        return false;
      }
      return true;
    });
    return [...list].sort((a, b) =>
      compareMods(a, b, filters.sortBy, filters.orderDirection, debouncedSearch),
    );
  }, [
    modb.data,
    installedMods,
    favorites,
    filters.selectedModTags,
    filters.author,
    filters.side,
    filters.category,
    filters.favoritesOnly,
    filters.sortBy,
    filters.orderDirection,
    debouncedSearch,
  ]);

  // With the installed filter on, append installed zips that are not in the
  // fetched ModDB result (manually dropped local mods) so they stay manageable.
  const items = useMemo<BrowserItem[]>(() => {
    const entries: BrowserItem[] = filtered.map((mod) => ({ kind: "modb", mod }));
    if (filters.side !== "installed" || !installedMods) return entries;
    const fetched = modb.data?.mods ?? [];
    const matchedFiles = new Set(
      fetched.map((mod) => installedModOf(mod, installedMods)?.file).filter(Boolean),
    );
    const locals = installedMods.filter((entry) => !matchedFiles.has(entry.file));
    return [...entries, ...locals.map((mod): BrowserItem => ({ kind: "local", mod }))];
  }, [filtered, installedMods, filters.side, modb.data]);

  const mutationError =
    install.error ?? update.error ?? remove.error ?? pin.error ?? favorite.error;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <ModFiltersBar
        filters={filters}
        gameVersions={(gameVersionsQuery.data?.gameversions ?? []).map((entry) => entry.name)}
        modCount={items.length}
        modTags={tags.data?.tags ?? []}
        onRefresh={() => {
          void installed.refetch();
          void updates.refetch();
          void modb.refetch();
        }}
        refreshing={installed.isFetching || updates.isFetching || modb.isFetching}
        updateCount={updateCount}
      />

      {mutationError && (
        <p className="border border-error/40 bg-error/5 px-3 py-2 text-xs text-error">
          {errorMessage(mutationError)}
        </p>
      )}

      <BrokenModsBanner errors={installed.data?.errors ?? []} />
      <DuplicateModsBanner duplicates={duplicates} />
      <MissingDepsBanner missing={missing} />

      {modb.isLoading && !modb.data && <ListSkeleton rows={6} />}
      {modb.isError && (
        <p className="border border-error/40 bg-error/5 p-3 text-xs text-error">
          {errorMessage(modb.error)}
        </p>
      )}

      {modb.data && (
        <VirtualList
          empty={
            <p className="p-6 text-center text-xs text-muted-foreground">{t("mods.listEmpty")}</p>
          }
          estimateRowHeight={132}
          items={items}
          keyOf={(item) =>
            item.kind === "local" ? `local:${item.mod.file}` : `modb:${item.mod.modid}`
          }
          renderItem={(item) => {
            if (item.kind === "local") {
              const key = item.mod.modid.toLowerCase();
              const pending = activeJobs.some((job) => job.modid.toLowerCase() === key);
              return (
                <InstalledModRow
                  mod={item.mod}
                  onPin={() => pin.mutate({ modid: item.mod.modid, pinned: !pinned.has(key) })}
                  onPickVersion={() => setVersionPicker(item.mod)}
                  onRemove={() => remove.mutate(item.mod.file)}
                  onUpdate={(version) =>
                    update.mutate({
                      modid: item.mod.modid,
                      version,
                      file: item.mod.file,
                      name: item.mod.name,
                    })
                  }
                  pending={pending}
                  pinned={pinned.has(key)}
                  update={updateMap[key]}
                />
              );
            }
            const mod = item.mod;
            const installedMod = installedModOf(mod, installedMods);
            const updateEntry = updateOf(mod, updateMap);
            const isPinned = installedMod ? pinned.has(installedMod.modid.toLowerCase()) : false;
            const favorited = favorites.has(favoriteKeyOf(mod));
            const pending = activeJobs.some(
              (job) =>
                job.modid.toLowerCase() === String(mod.modid) ||
                (installedMod !== undefined &&
                  job.modid.toLowerCase() === installedMod.modid.toLowerCase()),
            );
            return (
              <ModBrowseRow
                activeTags={filters.selectedTagNames}
                favorited={favorited}
                installed={installedMod}
                mod={mod}
                onFavorite={() =>
                  favorite.mutate({ modid: favoriteKeyOf(mod), favorite: !favorited })
                }
                onInstall={() => install.mutate({ modid: String(mod.modid), name: mod.name })}
                onOpen={() => setDetailMod(mod)}
                onPickVersion={() => installedMod && setVersionPicker(installedMod)}
                onPin={() =>
                  installedMod && pin.mutate({ modid: installedMod.modid, pinned: !isPinned })
                }
                onRemove={() => installedMod && remove.mutate(installedMod.file)}
                onTagClick={(name) => {
                  const tag = tagByName.get(name);
                  if (tag) filters.handleTagClick(tag, filters.selectedTagNames.has(name));
                }}
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
                pending={pending}
                pinned={isPinned}
                tagColorMap={tagColorMap}
                update={updateEntry}
              />
            );
          }}
          scrollButtonAlign="center"
        />
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
