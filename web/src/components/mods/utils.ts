export function sideLabel(side: string): string {
  switch (side) {
    case "server":
      return "Server";
    case "client":
      return "Client";
    default:
      return "Client & Server";
  }
}

export function sideVariant(side: string): "info" | "warning" | "default" {
  switch (side) {
    case "server":
      return "info";
    case "client":
      return "warning";
    default:
      return "default";
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
