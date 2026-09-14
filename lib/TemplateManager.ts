import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const TEMPLATES_DIR = "./data/templates";

export interface TemplateInfo {
  id: string;      // "apigee-mock"
  filename: string; // "apigee-mock.yaml"
}

export class TemplateManager {
  private static ensureDir() {
    if (!fs.existsSync(TEMPLATES_DIR)) {
      fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
    }
  }

  static list(): TemplateInfo[] {
    this.ensureDir();
    return fs
      .readdirSync(TEMPLATES_DIR)
      .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
      .map((file) => {
        const id = path.basename(file, path.extname(file));
        return {
          id,
          filename: file,
        };
      });
  }

  static get(id: string): string | null {
    this.ensureDir();
    // Try both .yaml and .yml
    let filePath = path.join(TEMPLATES_DIR, `${id}.yaml`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(TEMPLATES_DIR, `${id}.yml`);
    }

    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
    return null;
  }

  static createOrUpdate(id: string, content: any): void {
    this.ensureDir();
    const sanitizedId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitizedId) {
      throw new Error("Invalid template ID");
    }
    const filePath = path.join(TEMPLATES_DIR, `${sanitizedId}.yaml`);
    const contentStr = typeof content === "string" ? content : yaml.dump(content);
    fs.writeFileSync(filePath, contentStr, "utf8");
  }

  static delete(id: string): boolean {
    this.ensureDir();
    let filePath = path.join(TEMPLATES_DIR, `${id}.yaml`);
    let deleted = false;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted = true;
    }
    filePath = path.join(TEMPLATES_DIR, `${id}.yml`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted = true;
    }
    return deleted;
  }
}
