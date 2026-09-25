import fs from "node:fs";
import path from "node:path";
import * as YAML from "yaml";
import { ApigeeTemplaterService } from "./aft/service";
import { ApigeeConverter } from "./aft/converter";
import type { Feature, Product, Proxy, Template, User } from "./aft/interfaces";
import { DataManager } from "./DataManager";
import { getGoogleAccessToken } from "./googleAuth";

export interface DeployedProxyInfo {
  name: string;
  basePaths: string[];
  routes?: any[];
  source: "template" | "feature" | "proxy";
}

export interface DeploymentResult {
  success: boolean;
  deploymentName: string;
  organization?: string;
  deployedProxies: DeployedProxyInfo[];
  importedProducts: string[];
  importedUsers: string[];
  importedKvm: string[];
  importedTests?: string[];
  errors?: string[];
  timestamp: string;
}

/**
 * Replaces any {var} placeholders with matching environment variables if set in process.env.
 * If the environment variable is not set, leaves the placeholder untouched.
 */
export function replaceEnvVariables(content: string): string {
  if (!content || typeof content !== "string") return content;
  return content.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, varName) => {
    // 1. Direct environment variable match: process.env[varName]
    if (process.env[varName] !== undefined) {
      return process.env[varName]!;
    }
    // 2. Upper snake case (e.g. {GoogleCloudProject} -> GOOGLE_CLOUD_PROJECT)
    const snake = varName
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toUpperCase();
    if (process.env[snake] !== undefined) {
      return process.env[snake]!;
    }
    // 3. Uppercase conversion
    const upper = varName.toUpperCase();
    if (process.env[upper] !== undefined) {
      return process.env[upper]!;
    }
    // If not set, return match unchanged
    return match;
  });
}

/**
 * Normalizes parameters array or object into a key-value dictionary
 */
export function extractParametersDict(rawParams: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawParams) return result;
  if (Array.isArray(rawParams)) {
    for (const p of rawParams) {
      if (p && typeof p === "object" && p.name) {
        const val = p.default ?? p.value ?? "";
        result[p.name] = replaceEnvVariables(String(val));
      }
    }
  } else if (typeof rawParams === "object") {
    for (const [k, v] of Object.entries(rawParams)) {
      const val = typeof v === "object" && v !== null ? (v as any).default ?? (v as any).value ?? "" : v ?? "";
      result[k] = replaceEnvVariables(String(val));
    }
  }
  return result;
}

export class DeploymentManager {
  private static lastResult: DeploymentResult | null = null;

  /**
   * Checks if raw string or object matches a deployment structure
   */
  public static isDeployment(input: any): boolean {
    if (!input) return false;
    let obj = input;
    if (typeof input === "string") {
      try {
        const trimmed = input.trim();
        if (trimmed.startsWith("{")) {
          obj = JSON.parse(trimmed);
        } else {
          obj = YAML.parse(trimmed);
        }
      } catch {
        return false;
      }
    }
    if (!obj || typeof obj !== "object") return false;

    if (obj.deployment && typeof obj.deployment === "object") return true;
    if (obj.type === "deployment") return true;
    if (Array.isArray(obj.templates) || Array.isArray(obj.features) || Array.isArray(obj.proxies)) return true;
    if (Array.isArray(obj.products) && (Array.isArray(obj.users) || obj.templates || obj.proxies)) return true;
    if (Array.isArray(obj.tests)) return true;

    return false;
  }

  /**
   * Compiles all deployment files in data/deployments/ into proxy YAMLs in data/proxies/
   */
  public static async generateProxiesFromDeployments(): Promise<string[]> {
    const deploymentsDir = DataManager.deploymentsDir;
    if (!fs.existsSync(deploymentsDir)) return [];

    const files = fs
      .readdirSync(deploymentsDir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"));
    const generatedProxies: string[] = [];

    const aftService = new ApigeeTemplaterService();
    const converter = new ApigeeConverter();

    for (const file of files) {
      try {
        const filePath = path.join(deploymentsDir, file);
        const raw = fs.readFileSync(filePath, "utf8");
        const substitutedRaw = replaceEnvVariables(raw);
        let doc = file.endsWith(".json") ? JSON.parse(substitutedRaw) : (YAML.parse(substitutedRaw) as any);
        if (doc && doc.deployment) doc = doc.deployment;
        if (!doc) continue;

        const parameters = extractParametersDict(doc.parameters);
        const proxiesToDeploy: { proxy: Proxy; source: "template" | "feature" | "proxy" }[] = [];

        // 1. Extract and save Products from deployment
        const rawProducts = doc.products || (doc.product ? [doc.product] : []);
        for (const prodItem of rawProducts) {
          try {
            let product: Product | undefined;
            if (typeof prodItem === "object" && prodItem !== null) {
              product = prodItem as Product;
            } else if (typeof prodItem === "string") {
              product = await aftService.productGet(prodItem.trim());
            }
            if (product && product.name) {
              DataManager.saveProduct(product);
            }
          } catch (e: any) {
            console.warn(`[DeploymentManager] Error extracting product ${prodItem}:`, e.message);
          }
        }

        // 2. Extract and save Users from deployment
        const rawUsers = doc.users || (doc.user ? [doc.user] : []);
        for (const userItem of rawUsers) {
          try {
            let user: User | undefined;
            if (typeof userItem === "object" && userItem !== null) {
              user = userItem as User;
            } else if (typeof userItem === "string") {
              user = await aftService.userGet(userItem.trim());
            }
            if (user) {
              DataManager.saveUser(user);
            }
          } catch (e: any) {
            console.warn(`[DeploymentManager] Error extracting user ${userItem}:`, e.message);
          }
        }

        // 3. Extract and save KVM from deployment
        const rawKvm = doc.kvms || doc.kvm || doc.keyvaluemaps || doc.keyvaluemap;
        if (Array.isArray(rawKvm)) {
          for (const item of rawKvm) {
            if (item && item.name) {
              DataManager.saveKvm(item.name, item.values || {});
            }
          }
        } else if (rawKvm && typeof rawKvm === "object") {
          for (const [mapId, mapData] of Object.entries(rawKvm)) {
            if (mapData && typeof mapData === "object") {
              DataManager.saveKvm(mapId, mapData as Record<string, any>);
            }
          }
        }

        // 3b. Extract and save Tests from deployment
        const rawTests = doc.tests || (doc.test ? [doc.test] : []);
        for (const testItem of rawTests) {
          if (testItem && typeof testItem === "object" && testItem.name) {
            DataManager.saveTest({
              name: testItem.name,
              proxy: testItem.proxy || "",
              verb: (testItem.verb || testItem.method || "POST").toUpperCase(),
              path: testItem.path || "",
              headers: testItem.headers || {},
              payload:
                typeof testItem.payload === "string"
                  ? testItem.payload
                  : testItem.body
                  ? typeof testItem.body === "string"
                    ? testItem.body
                    : JSON.stringify(testItem.body, null, 2)
                  : typeof testItem.payload === "object"
                  ? JSON.stringify(testItem.payload, null, 2)
                  : "",
              assertions: Array.isArray(testItem.assertions)
                ? testItem.assertions
                : testItem.assertions
                ? [testItem.assertions]
                : ["status.code == 200"],
              description: testItem.description || "",
              deploymentFile: file,
            });
          }
        }

        // 4. Process Features
        const rawFeatures = doc.features || (doc.feature ? [doc.feature] : []);
        for (const featItem of rawFeatures) {
          try {
            let feature: Feature | undefined;
            if (typeof featItem === "object" && featItem !== null) {
              feature = featItem as Feature;
            } else if (typeof featItem === "string") {
              feature = await aftService.featureGet(featItem);
            }
            if (feature) {
              const proxy = converter.featureToProxy(feature, parameters);
              if (!proxy.name) proxy.name = feature.name;
              proxiesToDeploy.push({ proxy, source: "feature" });
            }
          } catch (e: any) {
            console.warn(`[DeploymentManager] Error resolving feature ${featItem}:`, e.message);
          }
        }

        // 2. Process Templates
        const rawTemplates = doc.templates || (doc.template ? [doc.template] : []);
        for (const tplItem of rawTemplates) {
          try {
            let template: Template | undefined;
            if (typeof tplItem === "object" && tplItem !== null) {
              template = tplItem as Template;
            } else if (typeof tplItem === "string") {
              template = await aftService.templateGet(tplItem);
            }
            if (template) {
              // Save template definition in data/templates/ to preserve feature definitions
              const templatesDir = DataManager.templatesDir;
              if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
              fs.writeFileSync(
                path.join(templatesDir, `${template.name}.yaml`),
                YAML.stringify(template, { aliasDuplicateObjects: false }),
                "utf8"
              );

              // Resolve any products referenced inside template if not already loaded
              if (Array.isArray(template.products)) {
                for (const pName of template.products) {
                  if (typeof pName === "string" && !DataManager.getProduct(pName)) {
                    try {
                      const p = await aftService.productGet(pName);
                      if (p) DataManager.saveProduct(p);
                    } catch {}
                  }
                }
              }

              // Resolve any users referenced inside template if not already loaded
              if (Array.isArray(template.users)) {
                for (const uName of template.users) {
                  if (typeof uName === "string" && !DataManager.getUser(uName)) {
                    try {
                      const u = await aftService.userGet(uName);
                      if (u) DataManager.saveUser(u);
                    } catch {}
                  }
                }
              }

              // Resolve features needed by this template
              const resolvedFeatures: Feature[] = [];
              if (Array.isArray(template.features)) {
                for (const fItem of template.features) {
                  if (typeof fItem === "object" && fItem !== null) {
                    resolvedFeatures.push(fItem as Feature);
                  } else if (typeof fItem === "string") {
                    const feat = await aftService.featureGet(fItem);
                    if (feat) {
                      resolvedFeatures.push(feat);
                    }
                  }
                }
              }

              const proxy = converter.templateToProxy(template, resolvedFeatures, parameters);
              if (!proxy.name) proxy.name = template.name;
              proxiesToDeploy.push({ proxy, source: "template" });
            }
          } catch (e: any) {
            console.warn(`[DeploymentManager] Error resolving template ${tplItem}:`, e.message);
          }
        }

        // 3. Process Proxies
        const rawProxies = doc.proxies || (doc.proxy ? [doc.proxy] : []);
        for (const prxItem of rawProxies) {
          try {
            let proxy: Proxy | undefined;
            if (typeof prxItem === "object" && prxItem !== null) {
              proxy = prxItem as Proxy;
            } else if (typeof prxItem === "string") {
              const trimmed = prxItem.trim();
              proxy = await aftService.proxyGet(trimmed);
            }
            if (proxy) {
              proxiesToDeploy.push({ proxy, source: "proxy" });
            }
          } catch (e: any) {
            console.warn(`[DeploymentManager] Error resolving proxy ${prxItem}:`, e.message);
          }
        }

        // 4. Save generated proxy YAMLs into data/proxies/
        const proxiesDir = DataManager.proxiesDir;
        if (!fs.existsSync(proxiesDir)) fs.mkdirSync(proxiesDir, { recursive: true });

        for (const item of proxiesToDeploy) {
          const p = item.proxy;
          const proxyName = p.name || `proxy-${Date.now()}`;

          if (!p.endpoints || p.endpoints.length === 0) {
            p.endpoints = [
              {
                name: "default",
                basePath: `/${proxyName}`,
                routes: [{ name: "default", target: "default" }],
                flows: [],
              },
            ];
          }

          // Apply parameters and env vars to targets and endpoints
          if (p.targets && Array.isArray(p.targets)) {
            for (const t of p.targets) {
              if (t && t.url) {
                for (const [pk, pv] of Object.entries(parameters)) {
                  if (pv && t.url.includes(`{${pk}}`)) {
                    t.url = t.url.replaceAll(`{${pk}}`, pv);
                  }
                }
                t.url = replaceEnvVariables(t.url);
              }
            }
          }

          if (p.endpoints && Array.isArray(p.endpoints)) {
            for (const ep of p.endpoints) {
              if (ep && ep.basePath) {
                for (const [pk, pv] of Object.entries(parameters)) {
                  if (pv && ep.basePath.includes(`{${pk}}`)) {
                    ep.basePath = ep.basePath.replaceAll(`{${pk}}`, pv);
                  }
                }
                ep.basePath = replaceEnvVariables(ep.basePath);
              }
            }
          }

          const rawYamlStr = YAML.stringify(p, { aliasDuplicateObjects: false });
          const yamlStr = replaceEnvVariables(rawYamlStr);
          const targetFilePath = path.join(proxiesDir, `${proxyName}.yaml`);
          fs.writeFileSync(targetFilePath, yamlStr, "utf8");

          const templatesDir = DataManager.templatesDir;
          if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
          const templateFilePath = path.join(templatesDir, `${proxyName}.yaml`);
          if (!fs.existsSync(templateFilePath)) {
            fs.writeFileSync(templateFilePath, yamlStr, "utf8");
          }

          generatedProxies.push(proxyName);
        }
      } catch (err: any) {
        console.error(`[DeploymentManager] Error generating proxies from deployment ${file}:`, err.message);
      }
    }

    return generatedProxies;
  }

  /**
   * Processes a deployment document (YAML or JSON)
   */
  public static async deploy(
    input: string | any,
    options?: { org?: string; drz?: string; build?: boolean }
  ): Promise<DeploymentResult> {
    let doc: any = input;
    if (typeof input === "string") {
      const substituted = replaceEnvVariables(input);
      const trimmed = substituted.trim();
      if (trimmed.startsWith("{")) {
        doc = JSON.parse(trimmed);
      } else {
        doc = YAML.parse(trimmed);
      }
    }

    if (!doc || typeof doc !== "object") {
      throw new Error("Invalid deployment document: must be a valid YAML or JSON object");
    }

    // Unwrap if nested under deployment
    if (doc.deployment && typeof doc.deployment === "object") {
      doc = doc.deployment;
    }

    const deploymentName = doc.name || doc.id || `deployment-${Date.now()}`;
    const org = doc.organization || doc.org || options?.org || process.env.APIGEE_ORG || "";
    const drz = doc.drz || options?.drz || "";
    const parameters = extractParametersDict(doc.parameters);

    const aftService = new ApigeeTemplaterService();
    const converter = new ApigeeConverter();

    const deployedProxies: DeployedProxyInfo[] = [];
    const importedProducts: string[] = [];
    const importedUsers: string[] = [];
    const importedKvm: string[] = [];
    const importedTests: string[] = [];
    const errors: string[] = [];

    let googleToken: string | null = null;
    const getAuthHeader = async () => {
      if (!googleToken) {
        googleToken = await getGoogleAccessToken();
      }
      return googleToken.startsWith("Bearer ") ? googleToken : `Bearer ${googleToken}`;
    };

    // 1. Process Products
    const rawProducts = doc.products || (doc.product ? [doc.product] : []);
    for (const prodItem of rawProducts) {
      try {
        let product: Product | undefined;
        if (typeof prodItem === "object" && prodItem !== null) {
          product = prodItem as Product;
        } else if (typeof prodItem === "string") {
          const trimmed = prodItem.trim();
          // Check for org reference (e.g. "my-org:my-product")
          if (trimmed.includes(":") && !trimmed.startsWith("http")) {
            const [prodOrg, prodName] = trimmed.split(":");
            const authHeader = await getAuthHeader();
            const apigeeProd = await aftService.apigeeProductGet(prodName, prodOrg, drz, authHeader);
            if (apigeeProd) {
              product = converter.apigeeProductToProduct(apigeeProd);
            }
          } else {
            // First try local or repo
            product = await aftService.productGet(trimmed);
            // If not found and org is set, try Apigee X org
            if (!product && org) {
              try {
                const authHeader = await getAuthHeader();
                const apigeeProd = await aftService.apigeeProductGet(trimmed, org, drz, authHeader);
                if (apigeeProd) product = converter.apigeeProductToProduct(apigeeProd);
              } catch {}
            }
          }
        }

        if (product && product.name) {
          DataManager.saveProduct(product);
          importedProducts.push(product.name);
        } else {
          errors.push(`Could not resolve product: ${typeof prodItem === "string" ? prodItem : JSON.stringify(prodItem)}`);
        }
      } catch (err: any) {
        errors.push(`Error processing product ${prodItem}: ${err.message}`);
      }
    }

    // 2. Process Users
    const rawUsers = doc.users || (doc.user ? [doc.user] : []);
    for (const userItem of rawUsers) {
      try {
        let user: User | undefined;
        if (typeof userItem === "object" && userItem !== null) {
          user = userItem as User;
        } else if (typeof userItem === "string") {
          const trimmed = userItem.trim();
          // Check for org reference (e.g. "my-org:dev@example.com")
          if (trimmed.includes(":") && !trimmed.startsWith("http")) {
            const [userOrg, userEmail] = trimmed.split(":");
            const authHeader = await getAuthHeader();
            user = await aftService.apigeeUserGet(userEmail, userOrg, drz, authHeader);
          } else {
            // First try local or repo
            user = await aftService.userGet(trimmed);
            // If not found and org is set, try Apigee X org
            if (!user && org) {
              try {
                const authHeader = await getAuthHeader();
                user = await aftService.apigeeUserGet(trimmed, org, drz, authHeader);
              } catch {}
            }
          }
        }

        if (user) {
          DataManager.saveUser(user);
          importedUsers.push(user.name || user.email || user.userName || "unnamed-user");
        } else {
          errors.push(`Could not resolve user: ${typeof userItem === "string" ? userItem : JSON.stringify(userItem)}`);
        }
      } catch (err: any) {
        errors.push(`Error processing user ${userItem}: ${err.message}`);
      }
    }

    // 3. Process KVM entries
    const rawKvm = doc.kvms || doc.kvm || doc.keyvaluemaps || doc.keyvaluemap;
    if (Array.isArray(rawKvm)) {
      for (const item of rawKvm) {
        if (item && item.name) {
          DataManager.saveKvm(item.name, item.values || {});
          importedKvm.push(item.name);
        }
      }
    } else if (rawKvm && typeof rawKvm === "object") {
      for (const [mapIdentifier, mapData] of Object.entries(rawKvm)) {
        if (mapData && typeof mapData === "object") {
          DataManager.saveKvm(mapIdentifier, mapData as Record<string, any>);
          importedKvm.push(mapIdentifier);
        }
      }
    }

    // 3b. Process Tests
    const rawTests = doc.tests || (doc.test ? [doc.test] : []);
    for (const testItem of rawTests) {
      if (testItem && typeof testItem === "object" && testItem.name) {
        DataManager.saveTest({
          name: testItem.name,
          proxy: testItem.proxy || "",
          verb: (testItem.verb || testItem.method || "POST").toUpperCase(),
          path: testItem.path || "",
          headers: testItem.headers || {},
          payload:
            typeof testItem.payload === "string"
              ? testItem.payload
              : testItem.body
              ? typeof testItem.body === "string"
                ? testItem.body
                : JSON.stringify(testItem.body, null, 2)
              : typeof testItem.payload === "object"
              ? JSON.stringify(testItem.payload, null, 2)
              : "",
          assertions: Array.isArray(testItem.assertions)
            ? testItem.assertions
            : testItem.assertions
            ? [testItem.assertions]
            : ["status.code == 200"],
          description: testItem.description || "",
          deploymentFile: deploymentName,
        });
        importedTests.push(testItem.name);
      }
    }

    // List of proxies to write and compile
    const proxiesToDeploy: { proxy: Proxy; source: "template" | "feature" | "proxy" }[] = [];

    // 4. Process Features
    const rawFeatures = doc.features || (doc.feature ? [doc.feature] : []);
    for (const featItem of rawFeatures) {
      try {
        let feature: Feature | undefined;
        if (typeof featItem === "object" && featItem !== null) {
          feature = featItem as Feature;
        } else if (typeof featItem === "string") {
          feature = await aftService.featureGet(featItem);
        }

        if (feature) {
          const proxy = converter.featureToProxy(feature, parameters);
          if (!proxy.name) proxy.name = feature.name;
          proxiesToDeploy.push({ proxy, source: "feature" });
        } else {
          errors.push(`Could not resolve feature: ${typeof featItem === "string" ? featItem : JSON.stringify(featItem)}`);
        }
      } catch (err: any) {
        errors.push(`Error processing feature ${featItem}: ${err.message}`);
      }
    }

    // 5. Process Templates
    const rawTemplates = doc.templates || (doc.template ? [doc.template] : []);
    for (const tplItem of rawTemplates) {
      try {
        let template: Template | undefined;
        if (typeof tplItem === "object" && tplItem !== null) {
          template = tplItem as Template;
        } else if (typeof tplItem === "string") {
          template = await aftService.templateGet(tplItem);
        }

        if (template) {
          // Save template definition in data/templates/ to preserve feature definitions
          const templatesDir = path.join(process.cwd(), "data", "templates");
          if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
          fs.writeFileSync(path.join(templatesDir, `${template.name}.yaml`), YAML.stringify(template, { aliasDuplicateObjects: false }), "utf8");

          // Resolve any products referenced inside template
          if (Array.isArray(template.products)) {
            for (const pName of template.products) {
              if (typeof pName === "string" && !DataManager.getProduct(pName)) {
                try {
                  const p = await aftService.productGet(pName);
                  if (p) {
                    DataManager.saveProduct(p);
                    importedProducts.push(p.name);
                  }
                } catch {}
              }
            }
          }

          // Resolve any users referenced inside template
          if (Array.isArray(template.users)) {
            for (const uName of template.users) {
              if (typeof uName === "string" && !DataManager.getUser(uName)) {
                try {
                  const u = await aftService.userGet(uName);
                  if (u) {
                    DataManager.saveUser(u);
                    importedUsers.push(u.name || u.email || "user");
                  }
                } catch {}
              }
            }
          }

          // Resolve features needed by this template
          const resolvedFeatures: Feature[] = [];
          if (Array.isArray(template.features)) {
            for (const fItem of template.features) {
              if (typeof fItem === "object" && fItem !== null) {
                resolvedFeatures.push(fItem as Feature);
              } else if (typeof fItem === "string") {
                const feat = await aftService.featureGet(fItem);
                if (feat) {
                  resolvedFeatures.push(feat);
                } else {
                  errors.push(`Template ${template.name}: feature ${fItem} could not be resolved`);
                }
              }
            }
          }

          const proxy = converter.templateToProxy(template, resolvedFeatures, parameters);
          if (!proxy.name) proxy.name = template.name;
          proxiesToDeploy.push({ proxy, source: "template" });
        } else {
          errors.push(`Could not resolve template: ${typeof tplItem === "string" ? tplItem : JSON.stringify(tplItem)}`);
        }
      } catch (err: any) {
        errors.push(`Error processing template ${tplItem}: ${err.message}`);
      }
    }

    // 6. Process Proxies
    const rawProxies = doc.proxies || (doc.proxy ? [doc.proxy] : []);
    for (const prxItem of rawProxies) {
      try {
        let proxy: Proxy | undefined;
        if (typeof prxItem === "object" && prxItem !== null) {
          proxy = prxItem as Proxy;
        } else if (typeof prxItem === "string") {
          const trimmed = prxItem.trim();
          // Check for org reference (e.g. "my-org:my-proxy")
          if (trimmed.includes(":") && !trimmed.startsWith("http")) {
            const [prxOrg, prxName] = trimmed.split(":");
            const authHeader = await getAuthHeader();
            const zipPath = await aftService.apigeeProxyGet(prxName, prxOrg, drz, authHeader);
            if (zipPath) {
              proxy = await converter.apigeeZipToProxy(prxName, zipPath);
            }
          } else {
            // Try local or repo proxy
            proxy = await aftService.proxyGet(trimmed);
            // If not found and org is set, try Apigee X org
            if (!proxy && org) {
              try {
                const authHeader = await getAuthHeader();
                const zipPath = await aftService.apigeeProxyGet(trimmed, org, drz, authHeader);
                if (zipPath) proxy = await converter.apigeeZipToProxy(trimmed, zipPath);
              } catch {}
            }
          }
        }

        if (proxy) {
          proxiesToDeploy.push({ proxy, source: "proxy" });
        } else {
          errors.push(`Could not resolve proxy: ${typeof prxItem === "string" ? prxItem : JSON.stringify(prxItem)}`);
        }
      } catch (err: any) {
        errors.push(`Error processing proxy ${prxItem}: ${err.message}`);
      }
    }

    // Save deployment document into data/deployments/
    const deploymentsDir = path.join(process.cwd(), "data", "deployments");
    if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
    try {
      const depYaml = typeof input === "string" ? input : YAML.stringify(input);
      fs.writeFileSync(path.join(deploymentsDir, `${deploymentName}.yaml`), depYaml, "utf8");
    } catch {}

    // 7. Deploy all proxies locally into ./data/proxies/
    const proxiesDir = path.join(process.cwd(), "data", "proxies");
    if (!fs.existsSync(proxiesDir)) fs.mkdirSync(proxiesDir, { recursive: true });

    for (const item of proxiesToDeploy) {
      const p = item.proxy;
      const proxyName = p.name || `proxy-${Date.now()}`;

      // Ensure endpoints exist
      const endpoints = p.endpoints || ((p as any).defaultEndpoint ? [(p as any).defaultEndpoint] : []);
      if (endpoints.length === 0) {
        p.endpoints = [
          {
            name: "default",
            basePath: `/${proxyName}`,
            routes: [{ name: "default", target: "default" }],
            flows: [],
          },
        ];
      }

      // Collect base paths
      const basePaths = (p.endpoints || []).map((ep: any) => ep.basePath || `/${proxyName}`);

      // Apply parameters and env vars to targets and endpoints
      if (p.targets && Array.isArray(p.targets)) {
        for (const t of p.targets) {
          if (t && t.url) {
            for (const [pk, pv] of Object.entries(parameters)) {
              if (pv && t.url.includes(`{${pk}}`)) {
                t.url = t.url.replaceAll(`{${pk}}`, pv);
              }
            }
            t.url = replaceEnvVariables(t.url);
          }
        }
      }

      if (p.endpoints && Array.isArray(p.endpoints)) {
        for (const ep of p.endpoints) {
          if (ep && ep.basePath) {
            for (const [pk, pv] of Object.entries(parameters)) {
              if (pv && ep.basePath.includes(`{${pk}}`)) {
                ep.basePath = ep.basePath.replaceAll(`{${pk}}`, pv);
              }
            }
            ep.basePath = replaceEnvVariables(ep.basePath);
          }
        }
      }

      // Serialize to YAML and save to ./data/proxies/{name}.yaml and ./data/templates/
      const rawYamlStr = YAML.stringify(p, { aliasDuplicateObjects: false });
      const yamlStr = replaceEnvVariables(rawYamlStr);
      const targetFilePath = path.join(proxiesDir, `${proxyName}.yaml`);
      fs.writeFileSync(targetFilePath, yamlStr, "utf8");

      const templatesDir = path.join(process.cwd(), "data", "templates");
      if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
      const templateFilePath = path.join(templatesDir, `${proxyName}.yaml`);
      if (!fs.existsSync(templateFilePath)) {
        fs.writeFileSync(templateFilePath, yamlStr, "utf8");
      }

      deployedProxies.push({
        name: proxyName,
        basePaths,
        routes: (p.endpoints || []).flatMap((ep: any) => ep.routes || []),
        source: item.source,
      });
    }

    // 8. Trigger local build & compilation
    if (options?.build !== false && proxiesToDeploy.length > 0) {
      try {
        const { runBuild } = await import("../build");
        await runBuild();
      } catch (buildErr: any) {
        errors.push(`Build compilation failed: ${buildErr.message}`);
      }
    }

    const result: DeploymentResult = {
      success: errors.length === 0 || deployedProxies.length > 0,
      deploymentName,
      organization: org || undefined,
      deployedProxies,
      importedProducts,
      importedUsers,
      importedKvm,
      importedTests: importedTests.length > 0 ? importedTests : undefined,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };

    this.lastResult = result;
    return result;
  }

  public static getStatus(): DeploymentResult | null {
    return this.lastResult;
  }
}
