/**
 * Version helpers mirroring the manager's `compare_versions`:
 * numeric comparison with prerelease suffixes sorting below the release and
 * among themselves by their numeric parts (dev.26 > dev.1).
 */

function parseVersion(value: string): { key: number[]; pre: string | null } {
  const [base, ...rest] = value.split(/[-+]/);
  return {
    key: base
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(Number),
    pre: rest.length > 0 ? rest.join("-") : null,
  };
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function compareSemver(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const base = compareKeys(pa.key, pb.key);
  if (base !== 0) return base;

  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;

  const preKey = (pre: string) =>
    pre
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(Number);
  const pre = compareKeys(preKey(pa.pre), preKey(pb.pre));
  if (pre !== 0) return pre;
  return pa.pre.localeCompare(pb.pre);
}

export function sortReleasesDesc<T extends { modversion: string }>(releases: T[]): T[] {
  return [...releases].sort((a, b) => compareSemver(b.modversion, a.modversion));
}

export function latestRelease<T extends { modversion: string }>(
  releases: T[] | undefined,
): T | undefined {
  return sortReleasesDesc(releases ?? [])[0];
}

/**
 * The release to install for a dependency: the newest satisfying the minimum
 * version constraint, falling back to the newest release.
 */
export function pickDependencyRelease<T extends { modversion: string }>(
  releases: T[] | undefined,
  constraint: string,
): T | undefined {
  const latest = latestRelease(releases);
  if (!latest) return undefined;
  const wanted = constraint.trim();
  if (!wanted) return latest;
  const satisfying = (releases ?? []).filter(
    (release) => compareSemver(release.modversion, wanted) >= 0,
  );
  return latestRelease(satisfying) ?? latest;
}

export interface MissingDependency {
  modid: string;
  /** Version requirement from `modinfo.json` (empty when unconstrained). */
  constraint: string;
  /** Installed mods whose `modinfo.json` requires this dependency. */
  requiredBy: string[];
}

export interface DependencyCarrier {
  modid: string;
  name: string;
  dependencies: Record<string, string>;
}

/**
 * Dependencies named by installed mods that are not installed themselves.
 * The `game` entry is the game version requirement, not a mod; modids are
 * compared case-insensitively.
 */
export function findMissingDependencies(
  mods: DependencyCarrier[] | undefined,
): MissingDependency[] {
  const installed = new Set((mods ?? []).map((mod) => mod.modid.toLowerCase()));
  const missing = new Map<string, MissingDependency>();

  for (const mod of mods ?? []) {
    for (const [rawId, constraint] of Object.entries(mod.dependencies ?? {})) {
      const id = rawId.trim().toLowerCase();
      if (!id || id === "game" || installed.has(id)) continue;

      const entry = missing.get(id) ?? { modid: id, constraint: "", requiredBy: [] };
      if (!entry.constraint) entry.constraint = constraint.trim();
      if (!entry.requiredBy.includes(mod.name)) entry.requiredBy.push(mod.name);
      missing.set(id, entry);
    }
  }

  return [...missing.values()].sort((a, b) => a.modid.localeCompare(b.modid));
}
