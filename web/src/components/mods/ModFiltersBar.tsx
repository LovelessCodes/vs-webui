import {
  ArrowDownNarrowWide,
  ArrowUpDown,
  ArrowUpNarrowWide,
  CalendarDays,
  ListFilter,
  RefreshCw,
  Star,
  Tags,
} from "lucide-react";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ModTag } from "@/lib/api";
import { sortOptions, stripped, type SortBy } from "@/lib/mod-sort";
import { compareSemver } from "@/lib/version";

import ModAuthorFilter from "./ModAuthorFilter";
import ModSearchInput from "./ModSearchInput";
import UpdateAllButton from "./UpdateAllButton";
import {
  categoryOptions,
  sideLabelKeys,
  sideOptions,
  type Category,
  type ModFiltersState,
  type Side,
} from "./use-mod-filters";

/** Search, version/tag/author pickers, sort and side controls above the mod list. */
export default function ModFiltersBar({
  filters,
  gameVersions,
  modTags,
  modCount,
  updateCount,
  onRefresh,
  refreshing,
}: {
  filters: ModFiltersState;
  gameVersions: string[];
  modTags: ModTag[];
  modCount: number;
  updateCount: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useTranslation();
  const versionAnchor = useRef<HTMLDivElement | null>(null);
  const tagAnchor = useRef<HTMLDivElement | null>(null);
  const {
    author,
    category,
    favoritesOnly,
    orderDirection,
    searchText,
    selectedGameVersions,
    selectedModTags,
    setAuthor,
    setCategory,
    setFavoritesOnly,
    setOrderDirection,
    setSearchText,
    setSelectedGameVersions,
    setSelectedModTags,
    setSide,
    setSortBy,
    side,
    sortBy,
  } = filters;

  const sortedGameVersions = useMemo(
    () => [...gameVersions].sort((a, b) => compareSemver(b, a)),
    [gameVersions],
  );
  const sortedTags = useMemo(
    () => [...modTags].sort((a, b) => stripped(a.name).localeCompare(stripped(b.name))),
    [modTags],
  );
  const tagByName = useMemo(() => {
    const map: Record<string, ModTag> = {};
    for (const tag of modTags) map[tag.name] = tag;
    return map;
  }, [modTags]);
  const tagColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tag of modTags) map[tag.name] = tag.color;
    return map;
  }, [modTags]);

  const selectedTagNames = useMemo(() => selectedModTags.map((tag) => tag.name), [selectedModTags]);
  const tagNames = useMemo(() => sortedTags.map((tag) => tag.name), [sortedTags]);
  const handleTagNamesChange = (names: string[]) => {
    setSelectedModTags(
      names.map((name) => tagByName[name]).filter((tag): tag is ModTag => tag !== undefined),
    );
  };

  const sortItems = useMemo(
    () => Object.entries(sortOptions).map(([value, labelKey]) => ({ label: t(labelKey), value })),
    [t],
  );
  const categoryItems = useMemo(
    () =>
      Object.entries(categoryOptions).map(([value, labelKey]) => ({
        label: t(labelKey),
        value,
      })),
    [t],
  );

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ModSearchInput className="w-full sm:w-72" onChange={setSearchText} value={searchText} />

        <Combobox
          items={sortedGameVersions}
          multiple
          onValueChange={(value) =>
            setSelectedGameVersions(Array.isArray(value) ? (value as string[]) : [])
          }
          value={selectedGameVersions}
        >
          <ComboboxChips className="w-52" ref={versionAnchor}>
            <CalendarDays className="text-muted-foreground size-3.5 shrink-0" />
            <ComboboxValue>
              {(values: string[]) => (
                <>
                  {values.slice(0, 2).map((version) => (
                    <ComboboxChip key={version}>{version}</ComboboxChip>
                  ))}
                  {values.length > 2 && (
                    <span className="bg-muted text-muted-foreground inline-flex items-center px-1.5 py-0.5 text-xs">
                      +{values.length - 2}
                    </span>
                  )}
                  <ComboboxInput
                    aria-label={t("mods.filterGameVersionsAria")}
                    placeholder={values.length > 0 ? "" : t("mods.filterGameVersionsPlaceholder")}
                  />
                </>
              )}
            </ComboboxValue>
          </ComboboxChips>
          <ComboboxContent anchor={versionAnchor}>
            <ComboboxEmpty>{t("mods.filterGameVersionsEmpty")}</ComboboxEmpty>
            <ComboboxList>
              {(version: string) => (
                <ComboboxItem key={version} value={version}>
                  {version}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>

        <Combobox
          items={tagNames}
          multiple
          onValueChange={(value) =>
            handleTagNamesChange(Array.isArray(value) ? (value as string[]) : [])
          }
          value={selectedTagNames}
        >
          <ComboboxChips className="w-52" ref={tagAnchor}>
            <Tags className="text-muted-foreground size-3.5 shrink-0" />
            <ComboboxValue>
              {(values: string[]) => (
                <>
                  {values.slice(0, 2).map((name) => {
                    const color = tagColorMap[name];
                    return (
                      <ComboboxChip
                        className="border"
                        key={name}
                        style={
                          color
                            ? {
                                backgroundColor: `${color}20`,
                                borderColor: `${color}50`,
                                color,
                              }
                            : undefined
                        }
                      >
                        {name}
                      </ComboboxChip>
                    );
                  })}
                  {values.length > 2 && (
                    <span className="bg-muted text-muted-foreground inline-flex items-center px-1.5 py-0.5 text-xs">
                      +{values.length - 2}
                    </span>
                  )}
                  <ComboboxInput
                    aria-label={t("mods.filterTagsAria")}
                    placeholder={values.length > 0 ? "" : t("mods.filterTagsPlaceholder")}
                  />
                </>
              )}
            </ComboboxValue>
          </ComboboxChips>
          <ComboboxContent anchor={tagAnchor}>
            <ComboboxEmpty>{t("mods.filterTagsEmpty")}</ComboboxEmpty>
            <ComboboxList>
              {(name: string) => (
                <ComboboxItem key={name} value={name}>
                  {name}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>

        <ModAuthorFilter
          onChange={setAuthor}
          searchText={searchText}
          selectedGameVersions={selectedGameVersions}
          value={author}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={sortItems}
          onValueChange={(value) => {
            if (typeof value === "string") setSortBy(value as SortBy);
          }}
          value={sortBy}
        >
          <SelectTrigger aria-label={t("mods.sortAria")} size="sm">
            <ArrowUpDown className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {sortItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          aria-label={t("mods.toggleSortDirection")}
          onClick={() =>
            setOrderDirection(orderDirection === "descending" ? "ascending" : "descending")
          }
          size="icon-sm"
          title={
            orderDirection === "descending"
              ? t("mods.sortDescending")
              : t("mods.sortAscending")
          }
          variant="outline"
        >
          {orderDirection === "descending" ? <ArrowDownNarrowWide /> : <ArrowUpNarrowWide />}
        </Button>

        <Button
          aria-label={t("mods.favoritesAria")}
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          size="icon-sm"
          title={t("mods.favoritesLabel")}
          variant={favoritesOnly ? "outline-amber" : "outline"}
        >
          <Star className={favoritesOnly ? "fill-current" : undefined} />
        </Button>

        <Select
          items={categoryItems}
          onValueChange={(value) => {
            if (typeof value === "string") setCategory(value as Category);
          }}
          value={category}
        >
          <SelectTrigger aria-label={t("mods.categoryAria")} size="sm">
            <ListFilter className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {categoryItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[10px] font-medium tracking-widest uppercase">
            {t("mods.sideLabel")}
          </span>
          <ToggleGroup
            aria-label={t("mods.sideLabel")}
            onValueChange={(value) => {
              if (value[0]) setSide(value[0] as Side);
            }}
            size="sm"
            value={[side]}
            variant="outline"
          >
            {sideOptions.map((option) => (
              <ToggleGroupItem key={option} value={option}>
                {t(sideLabelKeys[option])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="text-muted-foreground ms-auto flex flex-wrap items-center gap-3 text-xs">
          <span className="tabular-nums">{t("mods.count", { count: modCount })}</span>
          {updateCount > 0 && <UpdateAllButton updateCount={updateCount} />}
          <Button
            aria-label={t("common.refresh")}
            disabled={refreshing}
            onClick={onRefresh}
            size="icon-sm"
            title={t("common.refresh")}
            variant="outline"
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>
    </div>
  );
}
