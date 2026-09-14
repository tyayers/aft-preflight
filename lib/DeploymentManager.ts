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
  errors?: string[];
  timestamp: string;
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

    return false;
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
      const trimmed = input.trim();
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
    const parameters = doc.parameters || {};

    const aftService = new ApigeeTemplaterService();
    const converter = new ApigeeConverter();

    const deployedProxies: DeployedProxyInfo[] = [];
    const importedProducts: string[] = [];
    const importedUsers: string[] = [];
    const importedKvm: string[] = [];
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
    const rawKvm = doc.kvm || doc.keyvaluemaps || doc.keyvaluemap;
    if (rawKvm && typeof rawKvm === "object") {
      for (const [mapIdentifier, mapData] of Object.entries(rawKvm)) {
        if (mapData && typeof mapData === "object") {
          DataManager.saveKvm(mapIdentifier, mapData as Record<string, any>);
          importedKvm.push(mapIdentifier);
        }
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

    // 7. Deploy all proxies locally into ./data/templates/
    const templatesDir = path.join(process.cwd(), "data", "templates");
    if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });

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

      // Serialize to YAML and save to ./templates/{name}.yaml
      const yamlStr = YAML.stringify(p, { aliasDuplicateObjects: false });
      const targetFilePath = path.join(templatesDir, `${proxyName}.yaml`);
      fs.writeFileSync(targetFilePath, yamlStr, "utf8");

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
