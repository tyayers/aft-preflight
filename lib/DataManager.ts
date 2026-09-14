import fs from "node:fs";
import path from "node:path";
import * as YAML from "yaml";
import type { Product, User, UserApp, UserCredential } from "./aft/interfaces";
import { globalKvmStore } from "./policies/KeyValueMapOperations";

export class DataManager {
  private static products: Map<string, Product> = new Map();
  private static users: Map<string, User> = new Map();
  private static initialized: boolean = false;

  public static get dataDir(): string {
    return path.join(process.cwd(), "data");
  }

  public static get productsDir(): string {
    return path.join(this.dataDir, "products");
  }

  public static get usersDir(): string {
    return path.join(this.dataDir, "users");
  }

  public static get kvmDir(): string {
    return path.join(this.dataDir, "kvm");
  }

  /**
   * Initializes data directories and loads products, users, and KVM data from disk into memory.
   */
  public static async initialize(): Promise<void> {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      if (!fs.existsSync(this.productsDir)) fs.mkdirSync(this.productsDir, { recursive: true });
      if (!fs.existsSync(this.usersDir)) fs.mkdirSync(this.usersDir, { recursive: true });
      if (!fs.existsSync(this.kvmDir)) fs.mkdirSync(this.kvmDir, { recursive: true });

      this.loadProducts();
      this.loadUsers();
      this.loadKvm();
      this.initialized = true;

      console.log(
        `[DataManager] Initialized. Loaded ${this.products.size} products, ${this.users.size} users, ${Object.keys(globalKvmStore).length} KVM maps.`
      );
    } catch (err: any) {
      console.error("[DataManager] Initialization error:", err.message);
    }
  }

  /**
   * Load products from data/products/ and data/products.(yaml|json)
   */
  public static loadProducts(): void {
    if (fs.existsSync(this.productsDir)) {
      const files = fs.readdirSync(this.productsDir);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json")) {
          try {
            const raw = fs.readFileSync(path.join(this.productsDir, file), "utf8");
            const parsed = file.endsWith(".json") ? JSON.parse(raw) : (YAML.parse(raw) as any);
            if (parsed) {
              const items = Array.isArray(parsed) ? parsed : [parsed];
              for (const item of items) {
                if (item && item.name) {
                  this.products.set(item.name, item);
                }
              }
            }
          } catch (e: any) {
            console.warn(`[DataManager] Error reading product file ${file}:`, e.message);
          }
        }
      }
    }

    // Also check single data/products.yaml or data/products.json
    for (const ext of ["yaml", "yml", "json"]) {
      const singlePath = path.join(this.dataDir, `products.${ext}`);
      if (fs.existsSync(singlePath)) {
        try {
          const raw = fs.readFileSync(singlePath, "utf8");
          const parsed = ext === "json" ? JSON.parse(raw) : (YAML.parse(raw) as any);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && item.name) this.products.set(item.name, item);
            }
          } else if (parsed && parsed.name) {
            this.products.set(parsed.name, parsed);
          }
        } catch {}
      }
    }
  }

  /**
   * Load users from data/users/ and data/users.(yaml|json)
   */
  public static loadUsers(): void {
    if (fs.existsSync(this.usersDir)) {
      const files = fs.readdirSync(this.usersDir);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json")) {
          try {
            const raw = fs.readFileSync(path.join(this.usersDir, file), "utf8");
            const parsed = file.endsWith(".json") ? JSON.parse(raw) : (YAML.parse(raw) as any);
            if (parsed) {
              const items = Array.isArray(parsed) ? parsed : [parsed];
              for (const item of items) {
                if (item) {
                  const key = item.name || item.email || item.userName;
                  if (key) this.users.set(key, item);
                }
              }
            }
          } catch (e: any) {
            console.warn(`[DataManager] Error reading user file ${file}:`, e.message);
          }
        }
      }
    }

    // Also check single data/users.yaml or data/users.json
    for (const ext of ["yaml", "yml", "json"]) {
      const singlePath = path.join(this.dataDir, `users.${ext}`);
      if (fs.existsSync(singlePath)) {
        try {
          const raw = fs.readFileSync(singlePath, "utf8");
          const parsed = ext === "json" ? JSON.parse(raw) : (YAML.parse(raw) as any);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item) {
                const key = item.name || item.email || item.userName;
                if (key) this.users.set(key, item);
              }
            }
          } else if (parsed) {
            const key = parsed.name || parsed.email || parsed.userName;
            if (key) this.users.set(key, parsed);
          }
        } catch {}
      }
    }
  }

  /**
   * Load KVM maps from data/kvm/ into globalKvmStore
   */
  public static loadKvm(): void {
    if (fs.existsSync(this.kvmDir)) {
      const files = fs.readdirSync(this.kvmDir);
      for (const file of files) {
        if (file.endsWith(".json") || file.endsWith(".yaml") || file.endsWith(".yml")) {
          try {
            const mapId = path.basename(file, path.extname(file));
            const raw = fs.readFileSync(path.join(this.kvmDir, file), "utf8");
            const parsed = file.endsWith(".json") ? JSON.parse(raw) : (YAML.parse(raw) as any);
            if (parsed && typeof parsed === "object") {
              globalKvmStore[mapId] = {
                ...(globalKvmStore[mapId] || {}),
                ...parsed,
              };
            }
          } catch (e: any) {
            console.warn(`[DataManager] Error reading KVM file ${file}:`, e.message);
          }
        }
      }
    }
  }

  /**
   * Saves product to disk in data/products/ and updates in-memory cache
   */
  public static saveProduct(product: Product): void {
    if (!product || !product.name) return;
    this.products.set(product.name, product);
    try {
      if (!fs.existsSync(this.productsDir)) fs.mkdirSync(this.productsDir, { recursive: true });
      const filePath = path.join(this.productsDir, `${product.name}.yaml`);
      fs.writeFileSync(filePath, YAML.stringify(product, { aliasDuplicateObjects: false }), "utf8");
    } catch (err: any) {
      console.error(`[DataManager] Error saving product ${product.name}:`, err.message);
    }
  }

  /**
   * Saves user to disk in data/users/ and updates in-memory cache
   */
  public static saveUser(user: User): void {
    if (!user) return;
    const key = user.name || user.email || user.userName;
    if (!key) return;
    this.users.set(key, user);
    try {
      if (!fs.existsSync(this.usersDir)) fs.mkdirSync(this.usersDir, { recursive: true });
      const safeKey = key.replace(/[/\\?%*:|"<>]/g, "_");
      const filePath = path.join(this.usersDir, `${safeKey}.yaml`);
      fs.writeFileSync(filePath, YAML.stringify(user, { aliasDuplicateObjects: false }), "utf8");
    } catch (err: any) {
      console.error(`[DataManager] Error saving user ${key}:`, err.message);
    }
  }

  /**
   * Saves KVM map to disk in data/kvm/ and updates globalKvmStore
   */
  public static saveKvm(mapIdentifier: string, data: Record<string, any>): void {
    if (!mapIdentifier) return;
    globalKvmStore[mapIdentifier] = {
      ...(globalKvmStore[mapIdentifier] || {}),
      ...data,
    };
    try {
      if (!fs.existsSync(this.kvmDir)) fs.mkdirSync(this.kvmDir, { recursive: true });
      const filePath = path.join(this.kvmDir, `${mapIdentifier}.json`);
      fs.writeFileSync(filePath, JSON.stringify(globalKvmStore[mapIdentifier], null, 2), "utf8");
    } catch (err: any) {
      console.error(`[DataManager] Error saving KVM ${mapIdentifier}:`, err.message);
    }
  }

  public static getProduct(name: string): Product | undefined {
    return this.products.get(name);
  }

  public static listProducts(): Product[] {
    return Array.from(this.products.values());
  }

  public static getUser(idOrEmail: string): User | undefined {
    if (this.users.has(idOrEmail)) return this.users.get(idOrEmail);
    for (const u of this.users.values()) {
      if (u.name === idOrEmail || u.email === idOrEmail || u.userName === idOrEmail) {
        return u;
      }
    }
    return undefined;
  }

  public static listUsers(): User[] {
    return Array.from(this.users.values());
  }

  /**
   * Finds user, app, and credential by API key (consumerKey)
   */
  public static getUserByApiKey(apiKey: string): { user: User; app: UserApp; credential: UserCredential } | null {
    if (!apiKey) return null;
    const trimmedKey = apiKey.trim();

    for (const user of this.users.values()) {
      const apps = user.apps || [];
      for (const app of apps) {
        const credentials = app.credentials || app.keys || [];
        for (const cred of credentials) {
          if (cred.consumerKey === trimmedKey || cred.key === trimmedKey) {
            return { user, app, credential: cred };
          }
        }
      }
    }
    return null;
  }

  public static clear(): void {
    this.products.clear();
    this.users.clear();
  }
}
