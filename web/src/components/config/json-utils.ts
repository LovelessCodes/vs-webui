export type JSONValue = string | number | boolean | null | JSONValue[] | JSONObject;
export interface JSONObject {
  [key: string]: JSONValue;
}

export function isObject(value: JSONValue): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pathKey(path: (string | number)[]): string {
  return path.join(".");
}

export function deepSet(
  current: JSONValue,
  path: (string | number)[],
  next: JSONValue,
): JSONValue {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (Array.isArray(current)) {
    const clone = [...current];
    const index = head as number;
    clone[index] = deepSet(clone[index], rest, next);
    return clone;
  }
  if (isObject(current)) {
    return { ...current, [head]: deepSet(current[head as string], rest, next) };
  }
  return current;
}

export function getAtPath(current: JSONValue, path: (string | number)[]): JSONValue {
  return path.reduce<JSONValue>((acc, key) => {
    if (Array.isArray(acc)) return acc[key as number];
    if (isObject(acc)) return acc[key as string];
    return acc;
  }, current);
}

/** Tolerant parse: JSON first, then minor sanitation (trailing commas). */
export function safeInitialParse(raw: string, setError: (message: string | null) => void): JSONValue {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  try {
    return JSON.parse(trimmed) as JSONValue;
  } catch {
    const attempt = trimmed.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(attempt) as JSONValue;
    } catch (error) {
      setError((error as Error).message);
      return {};
    }
  }
}
