import { useEffect, useMemo, useRef, useState } from "react";

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

const SIDE_VALUES: Side[] = ["any", "client", "server", "both", "installed"];
const CATEGORY_VALUES: Category[] = ["mod", "externaltool", "other"];
const SORT_VALUES: SortBy[] = [
  "relevance",
  "name",
  "trending",
  "downloads",
  "follows",
  "comments",
  "updated",
];

/**
 * Filter state shared by the filter bar and the browser list.
 * Initialized from and mirrored into the URL so filtered views are
 * shareable and survive reloads (Story Forge parity for filters).
 */
export function useModFilters(defaultVersion?: string) {
  const initial = useRef(new URLSearchParams(window.location.search)).current;
  const [searchText, setSearchText] = useState(initial.get("q") ?? "");
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>(
    (initial.get("tags") ?? "").split(",").filter(Boolean),
  );
  const [selectedGameVersions, setSelectedGameVersions] = useState<string[]>(
    (initial.get("versions") ?? "").split(",").filter(Boolean),
  );
  const [favoritesOnly, setFavoritesOnly] = useState(initial.get("fav") === "1");
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const value = initial.get("sort") as SortBy | null;
    return value && SORT_VALUES.includes(value) ? value : "trending";
  });
  const [orderDirection, setOrderDirection] = useState<OrderDirection>(
    initial.get("dir") === "desc" ? "descending" : "ascending",
  );
  const [author, setAuthor] = useState(initial.get("author") ?? "");
  const [side, setSide] = useState<Side>(() => {
    const value = initial.get("side") as Side | null;
    return value && SIDE_VALUES.includes(value) ? value : "any";
  });
  const [category, setCategory] = useState<Category>(() => {
    const value = initial.get("category") as Category | null;
    return value && CATEGORY_VALUES.includes(value) ? value : "mod";
  });

  // Seed the version filter with the active server version only when the URL
  // did not select versions explicitly.
  const versionSeeded = useRef(false);
  useEffect(() => {
    if (!versionSeeded.current && defaultVersion && !initial.get("versions")) {
      versionSeeded.current = true;
      setSelectedGameVersions([defaultVersion]);
    }
  }, [defaultVersion, initial]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (searchText) params.set("q", searchText);
    if (selectedGameVersions.length > 0) params.set("versions", selectedGameVersions.join(","));
    if (selectedTagNames.length > 0) params.set("tags", selectedTagNames.join(","));
    if (author) params.set("author", author);
    if (side !== "any") params.set("side", side);
    if (category !== "mod") params.set("category", category);
    if (sortBy !== "trending") params.set("sort", sortBy);
    if (orderDirection !== "ascending") params.set("dir", "desc");
    if (favoritesOnly) params.set("fav", "1");
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [
    searchText,
    selectedGameVersions,
    selectedTagNames,
    author,
    side,
    category,
    sortBy,
    orderDirection,
    favoritesOnly,
  ]);

  const selectedTagSet = useMemo(() => new Set(selectedTagNames), [selectedTagNames]);

  const toggleTag = (name: string) =>
    setSelectedTagNames((previous) =>
      previous.includes(name)
        ? previous.filter((entry) => entry !== name)
        : [...previous, name],
    );

  return {
    author,
    category,
    favoritesOnly,
    orderDirection,
    searchText,
    selectedGameVersions,
    selectedTagNames,
    selectedTagSet,
    setAuthor,
    setCategory,
    setFavoritesOnly,
    setOrderDirection,
    setSearchText,
    setSelectedGameVersions,
    setSelectedTagNames,
    setSide,
    setSortBy,
    side,
    sortBy,
    toggleTag,
  };
}

export type ModFiltersState = ReturnType<typeof useModFilters>;
