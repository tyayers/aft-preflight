export class Http {
  static getPath(url: string): string {
    const pieces = url.split("/");
    pieces.splice(0, 4);
    return pieces.join("/");
  }
}
