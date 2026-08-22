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
}
