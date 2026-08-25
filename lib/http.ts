export class Http {
  static getPath(url: string, basePath?: string): string {
    try {
      const parsed = new URL(url);
      let pathname = parsed.pathname;
      if (basePath) {
        if (pathname.startsWith(basePath)) {
          pathname = pathname.substring(basePath.length);
        }
      } else {
        const pieces = url.split("/");
        pieces.splice(0, 4);
        return pieces.join("/");
      }
      return pathname.replace(/^\/+/, "");
    } catch {
      const pieces = url.split("/");
      pieces.splice(0, 4);
      return pieces.join("/");
    }
  }

  static isStreaming(contentType?: string | null): boolean {
    if (!contentType) return false;
    const lower = contentType.toLowerCase();
    return (
      lower.includes("text/event-stream") ||
      lower.includes("application/x-ndjson") ||
      lower.includes("application/stream+json") ||
      lower.includes("application/x-json-stream") ||
      lower.includes("application/jsonl") ||
      lower.includes("application/x-jsonl") ||
      lower.includes("text/x-ndjson") ||
      lower.includes("multipart/x-mixed-replace")
    );
  }

  static isText(contentType?: string | null): boolean {
    if (!contentType) return true;
    const lower = contentType.toLowerCase().split(";")[0].trim();
    if (lower.startsWith("text/")) return true;
    if (lower.startsWith("application/json") || lower.endsWith("+json")) return true;
    if (lower.startsWith("application/xml") || lower.endsWith("+xml")) return true;
    if (
      lower === "application/javascript" ||
      lower === "application/x-javascript" ||
      lower === "application/ecmascript" ||
      lower === "application/typescript"
    ) return true;
    if (
      lower === "application/x-yaml" ||
      lower === "application/yaml" ||
      lower === "text/yaml"
    ) return true;
    if (lower === "application/x-www-form-urlencoded") return true;
    if (
      lower === "application/graphql" ||
      lower === "application/graphql-response+json" ||
      lower === "application/sql" ||
      lower === "application/csv"
    ) return true;
    if (lower === "image/svg+xml") return true;
    return false;
  }
}

