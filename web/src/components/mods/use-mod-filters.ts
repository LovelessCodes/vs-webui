import { useEffect, useMemo, useRef, useState } from "react";

import type { ModTag } from "@/lib/api";
import type { OrderDirection, SortBy } from "@/lib/mod-sort";

export type Side = "any" | "client" | "server" | "both" | "installed";
export type Category = "mod" | "externaltool" | "other";

/** Category values mapped to their `mods.category*` display-label keys. */
export const categoryOptions: Record<Category, string> = {
  externaltool: "mods.categoryExternalTool",
  mod: "mods.categoryMod",
  other: "mods.categoryOther",
};

export const sideOptions: Side[] = ["any", "client", "server", "both", "installed"];

export const sideLabelKeys: Record<Side, string> = {
  any: "mods.sideAny",
  both: "mods.sideBoth",
  client: "mods.sideClient",
  installed: "mods.sideInstalled",
  server: "mods.sideServer",
};

/** Filter state shared by the filter bar and the browser list (Story Forge parity). */
export function useModFilters(defaultVersion?: string) {
  const [searchText, setSearchText] = useState("");
  const [selectedModTags, setSelectedModTags] = useState<ModTag[]>([]);
  const [selectedGameVersions, setSelectedGameVersions] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("trending");
  const [orderDirection, setOrderDirection] = useState<OrderDirection>("ascending");
  const [author, setAuthor] = useState("");
  const [side, setSide] = useState<Side>("any");
  const [category, setCategory] = useState<Category>("mod");

  // Seed the version filter with the active server version once it is known;
  // the user can then add or remove versions freely.
  const versionSeeded = useRef(false);
  useEffect(() => {
    if (!versionSeeded.current && defaultVersion) {
      versionSeeded.current = true;
      setSelectedGameVersions([defaultVersion]);
    }
  }, [defaultVersion]);

  const selectedTagNames = useMemo(
    () => new Set(selectedModTags.map((tag) => tag.name)),
    [selectedModTags],
  );

  const addModTag = (tag: ModTag) =>
    setSelectedModTags((prev) => (prev.some((t) => t.tagid === tag.tagid) ? prev : [...prev, tag]));
  const removeModTag = (tag: ModTag) =>
    setSelectedModTags((prev) => prev.filter((t) => t.tagid !== tag.tagid));
  const handleTagClick = (tag: ModTag, isActive: boolean) => {
    if (isActive) {
      removeModTag(tag);
    } else {
      addModTag(tag);
    }
  };

  return {
    addModTag,
    author,
    category,
    favoritesOnly,
    handleTagClick,
    orderDirection,
    removeModTag,
    searchText,
    selectedGameVersions,
    selectedModTags,
    selectedTagNames,
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
  };
}

export type ModFiltersState = ReturnType<typeof useModFilters>;
