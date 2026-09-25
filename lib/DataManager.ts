import fs from "node:fs";
import path from "node:path";
import * as YAML from "yaml";
import type { Product, User, UserApp, UserCredential } from "./aft/interfaces";
import { globalKvmStore, DEFAULT_AI_CONFIG } from "./policies/KeyValueMapOperations";
import { replaceEnvVariables } from "./DeploymentManager";

export interface DeploymentTest {
  name: string;
  proxy: string;
  verb?: string;
  path?: string;
  headers?: Record<string, string>;
  payload?: string;
  assertions?: string[];
  description?: string;
  deploymentFile?: string;
}

export class DataManager {
  private static products: Map<string, Product> = new Map();
  private static users: Map<string, User> = new Map();
  private static tests: Map<string, DeploymentTest> = new Map();
  private static initialized: boolean = false;

  public static get dataDir(): string {
    return path.join(process.cwd(), "data");
  }

  public static get deploymentsDir(): string {
    return path.join(this.dataDir, "deployments");
  }

  public static get proxiesDir(): string {
    return path.join(this.dataDir, "proxies");
  }

  public static get templatesDir(): string {
    return path.join(this.dataDir, "templates");
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

  public static get testsDir(): string {
    return path.join(this.dataDir, "tests");
  }

  /**
   * Initializes data directories and loads deployments, products, users, tests, and KVM data from disk into memory.
   * Clears any previous in-memory cache so YAML files are always the initial truth on startup.
   */
  public static initializeSync(): void {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      if (!fs.existsSync(this.deploymentsDir)) fs.mkdirSync(this.deploymentsDir, { recursive: true });
      if (!fs.existsSync(this.proxiesDir)) fs.mkdirSync(this.proxiesDir, { recursive: true });
      if (!fs.existsSync(this.templatesDir)) fs.mkdirSync(this.templatesDir, { recursive: true });
      if (!fs.existsSync(this.productsDir)) fs.mkdirSync(this.productsDir, { recursive: true });
      if (!fs.existsSync(this.usersDir)) fs.mkdirSync(this.usersDir, { recursive: true });
      if (!fs.existsSync(this.kvmDir)) fs.mkdirSync(this.kvmDir, { recursive: true });
      if (!fs.existsSync(this.testsDir)) fs.mkdirSync(this.testsDir, { recursive: true });

      // Reset memory store to ensure YAML is always the initial truth on startup
      this.products.clear();
      this.users.clear();
      this.tests.clear();
      for (const k of Object.keys(globalKvmStore)) {
        delete globalKvmStore[k];
      }

      this.loadDeployments();
      this.loadProducts();
      this.loadUsers();
      this.loadKvm();
      if (globalKvmStore["AI-Config"]) {
        globalKvmStore["AI-Config"] = {
          ...DEFAULT_AI_CONFIG,
          ...globalKvmStore["AI-Config"],
        };
      }
      this.loadTests();
      this.initialized = true;

      console.log(
        `[DataManager] Initialized. Loaded ${this.products.size} products, ${this.users.size} users, ${this.tests.size} tests, ${Object.keys(globalKvmStore).length} KVM maps.`
      );
    } catch (err: any) {
      console.error("[DataManager] Initialization error:", err.message);
    }
  }

  public static async initialize(): Promise<void> {
    this.initializeSync();
  }

  /**
   * Load products, users, and KVM from data/deployments/*.yaml
   */
  public static loadDeployments(): void {
    if (fs.existsSync(this.deploymentsDir)) {
      const files = fs.readdirSync(this.deploymentsDir);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json")) {
          try {
            const raw = fs.readFileSync(path.join(this.deploymentsDir, file), "utf8");
            const substitutedRaw = replaceEnvVariables(raw);
            let doc = file.endsWith(".json") ? JSON.parse(substitutedRaw) : (YAML.parse(substitutedRaw) as any);
            if (doc && doc.deployment) doc = doc.deployment;
            if (!doc) continue;

            // Load products from deployment
            const rawProducts = doc.products || (doc.product ? [doc.product] : []);
            if (Array.isArray(rawProducts)) {
              for (const p of rawProducts) {
                if (p && typeof p === "object" && p.name) {
                  this.products.set(p.name, p);
                }
              }
            }

            // Load users from deployment
            const rawUsers = doc.users || (doc.user ? [doc.user] : []);
            if (Array.isArray(rawUsers)) {
              for (const u of rawUsers) {
                if (u && typeof u === "object") {
                  const key = u.name || u.email || u.userName;
                  if (key) this.users.set(key, u);
                }
              }
            }

            // Load KVM from deployment
            const rawKvm = doc.kvms || doc.kvm || doc.keyvaluemaps || doc.keyvaluemap;
            if (Array.isArray(rawKvm)) {
              for (const item of rawKvm) {
                if (item && item.name) {
                  globalKvmStore[item.name] = {
                    ...(globalKvmStore[item.name] || {}),
                    ...(item.values || {}),
                  };
                }
              }
            } else if (rawKvm && typeof rawKvm === "object") {
              for (const [mapId, mapData] of Object.entries(rawKvm)) {
                if (mapData && typeof mapData === "object") {
                  globalKvmStore[mapId] = {
                    ...(globalKvmStore[mapId] || {}),
                    ...(mapData as Record<string, any>),
                  };
                }
              }
            }

            // Load tests from deployment
            const rawTests = doc.tests || (doc.test ? [doc.test] : []);
            if (Array.isArray(rawTests)) {
              for (const t of rawTests) {
                if (t && typeof t === "object" && t.name) {
                  const proxyName = t.proxy || "";
                  const testObj: DeploymentTest = {
                    name: t.name,
                    proxy: proxyName,
                    verb: (t.verb || t.method || "POST").toUpperCase(),
                    path: t.path || "",
                    headers: t.headers || {},
                    payload:
                      typeof t.payload === "string"
                        ? t.payload
                        : t.body
                        ? typeof t.body === "string"
                          ? t.body
                          : JSON.stringify(t.body, null, 2)
                        : typeof t.payload === "object"
                        ? JSON.stringify(t.payload, null, 2)
                        : "",
                    assertions: Array.isArray(t.assertions)
                      ? t.assertions
                      : t.assertions
                      ? [t.assertions]
                      : ["status.code == 200"],
                    description: t.description || "",
                    deploymentFile: file,
                  };
                  this.tests.set(`${testObj.proxy}:${testObj.name}`, testObj);
                }
              }
            }
          } catch (e: any) {
            console.warn(`[DataManager] Error reading deployment file ${file}:`, e.message);
          }
        }
      }
    }
  }

  /**
   * Load standalone tests from data/tests/
   */
  public static loadTests(): void {
    if (fs.existsSync(this.testsDir)) {
      const files = fs.readdirSync(this.testsDir);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json")) {
          try {
            const raw = fs.readFileSync(path.join(this.testsDir, file), "utf8");
            const parsed = file.endsWith(".json") ? JSON.parse(raw) : (YAML.parse(raw) as any);
            if (parsed) {
              const items = Array.isArray(parsed) ? parsed : [parsed];
              for (const t of items) {
                if (t && t.name) {
                  const testObj: DeploymentTest = {
                    name: t.name,
                    proxy: t.proxy || "",
                    verb: (t.verb || t.method || "POST").toUpperCase(),
                    path: t.path || "",
                    headers: t.headers || {},
                    payload:
                      typeof t.payload === "string"
                        ? t.payload
                        : t.body
                        ? typeof t.body === "string"
                          ? t.body
                          : JSON.stringify(t.body, null, 2)
                        : typeof t.payload === "object"
                        ? JSON.stringify(t.payload, null, 2)
                        : "",
                    assertions: Array.isArray(t.assertions)
                      ? t.assertions
                      : t.assertions
                      ? [t.assertions]
                      : ["status.code == 200"],
                    description: t.description || "",
                    deploymentFile: file,
                  };
                  this.tests.set(`${testObj.proxy}:${testObj.name}`, testObj);
                }
              }
            }
          } catch (e: any) {
            console.warn(`[DataManager] Error reading test file ${file}:`, e.message);
          }
        }
      }
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
      const filePath = path.join(this.kvmDir, `${mapIdentifier}.yaml`);
      fs.writeFileSync(filePath, YAML.stringify(globalKvmStore[mapIdentifier], { aliasDuplicateObjects: false }), "utf8");
    } catch (err: any) {
      console.error(`[DataManager] Error saving KVM ${mapIdentifier}:`, err.message);
    }
  }

  public static getKvm(mapIdentifier: string): Record<string, any> | undefined {
    return globalKvmStore[mapIdentifier];
  }

  public static listKvmMaps(): string[] {
    return Object.keys(globalKvmStore);
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

  public static listTests(): DeploymentTest[] {
    return Array.from(this.tests.values());
  }

  public static getTestsForProxy(proxyName: string): DeploymentTest[] {
    if (!proxyName) return [];
    const cleanName = proxyName.replace(/\.(yaml|yml)$/, "");
    return Array.from(this.tests.values()).filter(
      (t) => t.proxy === proxyName || t.proxy === cleanName
    );
  }

  public static getTest(proxy: string, name: string): DeploymentTest | undefined {
    return this.tests.get(`${proxy}:${name}`) || Array.from(this.tests.values()).find((t) => t.name === name);
  }

  public static saveTest(test: DeploymentTest): void {
    if (!test || !test.name) return;
    this.tests.set(`${test.proxy}:${test.name}`, test);
    try {
      if (!fs.existsSync(this.testsDir)) fs.mkdirSync(this.testsDir, { recursive: true });
      const safeProxy = (test.proxy || "common").replace(/[/\\?%*:|"<>]/g, "_");
      const safeName = test.name.replace(/[/\\?%*:|"<>]/g, "_");
      const filePath = path.join(this.testsDir, `${safeProxy}_${safeName}.yaml`);
      fs.writeFileSync(filePath, YAML.stringify(test, { aliasDuplicateObjects: false }), "utf8");
    } catch (err: any) {
      console.error(`[DataManager] Error saving test ${test.name}:`, err.message);
    }
  }

  public static getSectionDir(section: string): string {
    switch (section) {
      case "deployments":
        return this.deploymentsDir;
      case "proxies":
        return this.proxiesDir;
      case "templates":
        return this.templatesDir;
      case "products":
        return this.productsDir;
      case "users":
        return this.usersDir;
      case "kvm":
        return this.kvmDir;
      case "tests":
        return this.testsDir;
      default:
        return path.join(this.dataDir, section);
    }
  }

  public static listDataFiles(section: string): string[] {
    const dir = this.getSectionDir(section);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"));
  }

  public static getDataFile(section: string, filename: string): string | null {
    const filePath = path.join(this.getSectionDir(section), filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  }

  public static saveDataFile(section: string, filename: string, content: string): boolean {
    const dir = this.getSectionDir(section);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, content, "utf8");

    // Hot reload in-memory cache if products, users, kvm, or tests
    try {
      if (section === "products") {
        this.loadProducts();
      } else if (section === "users") {
        this.loadUsers();
      } else if (section === "kvm") {
        this.loadKvm();
      } else if (section === "tests") {
        this.loadTests();
      }
    } catch (e: any) {
      console.warn(`[DataManager] Error reloading ${section} cache:`, e.message);
    }

    return true;
  }

  public static deleteDataFile(section: string, filename: string): boolean {
    const filePath = path.join(this.getSectionDir(section), filename);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);

    // Refresh memory cache
    try {
      if (section === "products") {
        this.products.clear();
        this.loadProducts();
      } else if (section === "users") {
        this.users.clear();
        this.loadUsers();
      } else if (section === "kvm") {
        this.loadKvm();
      } else if (section === "tests") {
        this.tests.clear();
        this.loadDeployments();
        this.loadTests();
      }
    } catch {}

    return true;
  }

  public static getDataSummary(): {
    counts: { deployments: number; proxies: number; products: number; kvm: number; users: number; tests: number };
    files: { deployments: string[]; proxies: string[]; products: string[]; kvm: string[]; users: string[]; tests: string[] };
    fileContents: Record<string, Record<string, string>>;
    tests: DeploymentTest[];
  } {
    const sections = ["deployments", "proxies", "products", "kvm", "users", "tests"] as const;
    const files: Record<string, string[]> = {};
    const counts: Record<string, number> = {};
    const fileContents: Record<string, Record<string, string>> = {};

    for (const sec of sections) {
      const secFiles = this.listDataFiles(sec);
      files[sec] = secFiles;
      counts[sec] = secFiles.length;
      fileContents[sec] = {};
      for (const f of secFiles) {
        const c = this.getDataFile(sec, f);
        if (c !== null) fileContents[sec][f] = c;
      }
    }

    // Always ensure test count includes in-memory tests parsed from deployments
    counts.tests = this.tests.size;

    return {
      counts: counts as any,
      files: files as any,
      fileContents,
      tests: this.listTests(),
    };
  }

  public static clear(): void {
    this.products.clear();
    this.users.clear();
    this.tests.clear();
  }
}
