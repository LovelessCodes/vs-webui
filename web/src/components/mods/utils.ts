export function sideKey(side: string): string {
  switch (side) {
    case "server":
      return "mods.server";
    case "client":
      return "mods.client";
    default:
      return "mods.both";
  }
}

/** Outline badge styling per mod side, matching the Story Forge idiom. */
export function sideBadgeClass(side: string): string {
  switch (side) {
    case "server":
      return "border-info/40 text-info";
    case "client":
      return "border-warning/40 text-warning";
    default:
      return "text-muted-foreground";
  }
}

/** Strip tags/entities from ModDB description HTML for plain-text display. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
