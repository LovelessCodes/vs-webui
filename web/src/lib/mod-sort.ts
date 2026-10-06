/**
 * Sort and relevance helpers for the mod browser.
 *
 * Ported from Story Forge's `lib/mod-sort.ts` (comparators and ranking) so the
 * sort options behave identically, plus the shared `stripped` normalizer.
 */

/** Fields of a mod that relevance ranking reads. */
export type RankableMod = {
  name: string;
  summary: string;
  tags: string[];
};

export const stripped = (str: string) =>
  str
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * True when the stripped query occurs inside one of the stripped tag names.
 *
 * The tags are searched as one newline-fenced string. Searching them joined
 * plainly would let a query match across two names ("stor" + "aged" would
 * match "storage"), and `stripped()` collapses whitespace to single spaces,
 * so the fence can occur neither in a tag nor in the query.
 */
function tagsContainQuery(tags: string[], query: string): boolean {
  const haystack = tags.map((tag) => `\n${stripped(tag)}\n`).join("");
  return haystack.includes(query);
}

/** Ranks match quality: exact name > name starts-with > name contains > tag match > description match. */
export function relevanceRank(mod: RankableMod, query: string): number {
  const q = stripped(query);
  if (!q) return 5;
  const name = stripped(mod.name);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (tagsContainQuery(mod.tags, q)) return 3;
  if (stripped(mod.summary).includes(q)) return 4;
  return 5;
}

export type OrderDirection = "ascending" | "descending";

/** Sort keys for the mod browser list (ModDB's list API has no `created`). */
export type SortBy =
  | "relevance"
  | "name"
  | "trending"
  | "downloads"
  | "follows"
  | "comments"
  | "updated";

/** Sort values mapped to their flat `mods.sort*` display-label keys. */
export const sortOptions: Record<SortBy, string> = {
  comments: "mods.sortComments",
  downloads: "mods.sortDownloads",
  follows: "mods.sortFollows",
  name: "mods.sortName",
  relevance: "mods.sortRelevance",
  trending: "mods.sortTrending",
  updated: "mods.sortUpdated",
};

type SortableMod = {
  name: string;
  summary: string;
  tags: string[];
  lastreleased: string;
  downloads: number;
  follows: number;
  trendingpoints: number;
  comments: number;
};

/** Comparator matching Story Forge's browser ordering (including its direction convention). */
export function compareMods(
  a: SortableMod,
  b: SortableMod,
  sortBy: SortBy,
  orderDirection: OrderDirection,
  searchText: string,
): number {
  if (sortBy === "relevance") {
    const rankA = relevanceRank(a, searchText);
    const rankB = relevanceRank(b, searchText);
    if (rankA !== rankB) {
      return orderDirection === "descending" ? rankB - rankA : rankA - rankB;
    }
    // Same relevance tier — break ties by trending points.
    const lengthDiff = stripped(a.name).length - stripped(b.name).length;
    if (lengthDiff !== 0) {
      return orderDirection === "descending" ? -lengthDiff : lengthDiff;
    }
    return orderDirection === "descending"
      ? a.trendingpoints - b.trendingpoints
      : b.trendingpoints - a.trendingpoints;
  }
  if (sortBy === "name") {
    return orderDirection === "descending"
      ? stripped(b.name).localeCompare(stripped(a.name))
      : stripped(a.name).localeCompare(stripped(b.name));
  }
  if (sortBy === "updated") {
    return orderDirection === "descending"
      ? new Date(b.lastreleased).getTime() - new Date(a.lastreleased).getTime()
      : new Date(a.lastreleased).getTime() - new Date(b.lastreleased).getTime();
  }
  if (sortBy === "downloads") {
    return orderDirection === "descending" ? a.downloads - b.downloads : b.downloads - a.downloads;
  }
  if (sortBy === "follows") {
    return orderDirection === "descending" ? a.follows - b.follows : b.follows - a.follows;
  }
  if (sortBy === "trending") {
    return orderDirection === "descending"
      ? a.trendingpoints - b.trendingpoints
      : b.trendingpoints - a.trendingpoints;
  }
  if (sortBy === "comments") {
    return orderDirection === "descending" ? a.comments - b.comments : b.comments - a.comments;
  }
  return orderDirection === "descending" ? 0 : -1;
}
