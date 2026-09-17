import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import * as YAML from "yaml";
import { DeploymentManager } from "../lib/DeploymentManager";
import { DataManager } from "../lib/DataManager";
import { verifyApiKey } from "../lib/policies/VerifyAPIKey";
import { ApigeeContext, ApigeeRequest, ApigeeResponse } from "../lib/apigee";
import { runBuild } from "../build";

describe("Deployment Manager & Native Bun Deployment Suite", () => {
  beforeAll(async () => {
    await DataManager.initialize();
  });

  afterAll(async () => {
    // Clean up test created template files, proxies, products, users, deployments
    const testTemplates = [
      "test-full-deployment-api.yaml",
      "test-feature-proxy.yaml",
      "test-converted-basic-api.yaml",
      "test-org-imported-proxy.yaml",
    ];
    for (const t of testTemplates) {
      const p = path.join(process.cwd(), "data", "templates", t);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      const prx = path.join(process.cwd(), "data", "proxies", t);
      if (fs.existsSync(prx)) fs.unlinkSync(prx);
    }
    const testProducts = ["ecommerce-product.yaml"];
    for (const pr of testProducts) {
      const p = path.join(process.cwd(), "data", "products", pr);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const testUsers = ["alice_developer.yaml"];
    for (const u of testUsers) {
      const p = path.join(process.cwd(), "data", "users", u);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const testDeployments = [
      "ecommerce-deployment.yaml",
      "imported-features-deployment.yaml",
      "single-feature-deployment.yaml",
      "converted-proxy-deployment.yaml",
      "apigee-x-org-deployment.yaml",
    ];
    for (const d of testDeployments) {
      const p = path.join(process.cwd(), "data", "deployments", d);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    await runBuild();
  });

  it("detects deployment documents vs regular proxies", () => {
    const deploymentYaml = `
name: my-deployment
type: deployment
templates:
  - template-01-basic-api
products:
  - product-01-standard-api
`;
    expect(DeploymentManager.isDeployment(deploymentYaml)).toBe(true);

    const deploymentJson = JSON.stringify({
      name: "json-deploy",
      templates: ["template-01"],
      features: ["feature-01"],
    });
    expect(DeploymentManager.isDeployment(deploymentJson)).toBe(true);

    const regularProxyYaml = `
name: single-proxy
endpoints:
  - basePath: /single
    routes:
      - name: default
        target: default
`;
    expect(DeploymentManager.isDeployment(regularProxyYaml)).toBe(false);
  });

  it("deploys a full deployment containing inline products, users, features, and proxies", async () => {
    const deploymentDoc = {
      name: "ecommerce-deployment",
      products: [
        {
          name: "ecommerce-product",
          displayName: "E-Commerce Public API Product",
          approvalType: "auto",
          environments: ["test", "prod"],
          proxies: ["test-full-deployment-api"],
          quota: "1000",
          quotaInterval: "1",
          quotaTimeUnit: "minute",
          attributes: [
            { name: "tier", value: "gold" },
          ],
        },
      ],
      users: [
        {
          name: "alice_developer",
          email: "alice@example.com",
          firstName: "Alice",
          lastName: "Smith",
          userName: "alicesmith",
          status: "active",
          apps: [
            {
              name: "AliceStoreApp",
              status: "approved",
              credentials: [
                {
                  consumerKey: "alice-api-key-12345",
                  consumerSecret: "alice-secret-67890",
                  status: "approved",
                  apiProducts: [
                    { apiproduct: "ecommerce-product", status: "approved" },
                  ],
                },
              ],
            },
          ],
        },
      ],
      kvm: {
        ecommerce_settings: {
          currency: "USD",
          tax_rate: "0.08",
        },
      },
      proxies: [
        {
          name: "test-full-deployment-api",
          endpoints: [
            {
              name: "default",
              basePath: "/ecommerce/v1",
              routes: [
                { name: "default", target: "default" },
              ],
              flows: [],
            },
          ],
          targets: [
            {
              name: "default",
              url: "https://httpbin.org/anything",
            },
          ],
        },
      ],
    };

    const result = await DeploymentManager.deploy(deploymentDoc);

    expect(result.success).toBe(true);
    expect(result.importedProducts).toContain("ecommerce-product");
    expect(result.importedUsers).toContain("alice_developer");
    expect(result.importedKvm).toContain("ecommerce_settings");
    expect(result.deployedProxies.some((p) => p.name === "test-full-deployment-api")).toBe(true);

    // Verify products and users are in DataManager
    const product = DataManager.getProduct("ecommerce-product");
    expect(product).toBeDefined();
    expect(product?.displayName).toBe("E-Commerce Public API Product");

    const user = DataManager.getUser("alice_developer");
    expect(user).toBeDefined();
    expect(user?.email).toBe("alice@example.com");

    // Verify disk files were created in ./data/
    expect(fs.existsSync(path.join(process.cwd(), "data/products/ecommerce-product.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "data/users/alice_developer.yaml"))).toBe(true);

    // Verify template file was generated
    expect(fs.existsSync(path.join(process.cwd(), "data/templates/test-full-deployment-api.yaml"))).toBe(true);

    // Verify VerifyAPIKey policy authenticates with imported user and extracts product attributes
    const ctx = new ApigeeContext();
    ctx.setVariable("request.header.x-api-key", "alice-api-key-12345");

    await verifyApiKey(
      {
        policyName: "VA-CheckKey",
        keyRef: "request.header.x-api-key",
      },
      ctx
    );

    expect(ctx.getVariable("developer.email")).toBe("alice@example.com");
    expect(ctx.getVariable("developer.app.name")).toBe("AliceStoreApp");
    expect(ctx.getVariable("client_id")).toBe("alice-api-key-12345");
    expect(ctx.getVariable("verifyapikey.VA-CheckKey.developer.email")).toBe("alice@example.com");
  });

  it("converts standalone feature to proxy and deploys it locally", async () => {
    const deploymentWithFeature = `
name: feature-deployment
features:
  - name: test-feature-proxy
    displayName: Standalone Feature Auth
    flows:
      - name: auth-flow
        steps:
          - name: FC-Assign
    policies:
      - AssignMessage:
          name: FC-Assign
          assignTo:
            type: response
          set:
            headers:
              - name: x-feature-applied
                value: "true"
`;

    const result = await DeploymentManager.deploy(deploymentWithFeature);
    expect(result.success).toBe(true);
    expect(result.deployedProxies.some((p) => p.name === "test-feature-proxy")).toBe(true);

    // Verify proxy YAML was generated
    expect(fs.existsSync(path.join(process.cwd(), "data/templates/test-feature-proxy.yaml"))).toBe(true);

    // Verify it compiled into proxies/
    expect(fs.existsSync(path.join(process.cwd(), "proxies/test-feature-proxy.ts"))).toBe(true);
  });

  it("converts template and references to a deployed proxy", async () => {
    const deploymentWithTemplate = `
name: template-deployment
templates:
  - name: test-converted-basic-api
    displayName: Converted Basic API
    features: []
    endpoints:
      - name: default
        basePath: /converted-basic
        routes:
          - name: default
            target: default
    targets:
      - name: default
        url: https://httpbin.org/get
`;

    const result = await DeploymentManager.deploy(deploymentWithTemplate);
    expect(result.success).toBe(true);
    expect(result.deployedProxies.some((p) => p.name === "test-converted-basic-api")).toBe(true);

    expect(fs.existsSync(path.join(process.cwd(), "data/templates/test-converted-basic-api.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "proxies/test-converted-basic-api.ts"))).toBe(true);
  });

  it("handles Apigee X org references in deployment gracefully", async () => {
    // Test deployment with org reference format "org:assetName"
    const deploymentWithOrg = {
      name: "apigee-x-org-deployment",
      organization: "mock-apigee-org",
      products: ["mock-apigee-org:org-product-1"],
      users: ["mock-apigee-org:org-dev@example.com"],
      proxies: [
        {
          name: "test-org-imported-proxy",
          endpoints: [
            {
              name: "default",
              basePath: "/org-imported",
              routes: [{ name: "default", target: "default" }],
            },
          ],
          targets: [{ name: "default", url: "https://httpbin.org/json" }],
        },
      ],
    };

    const result = await DeploymentManager.deploy(deploymentWithOrg);
    // Since mock-apigee-org is not a real Apigee X org, live fetch records error but allows deployment of included proxies
    expect(result.deployedProxies.some((p) => p.name === "test-org-imported-proxy")).toBe(true);
    expect(result.deploymentName).toBe("apigee-x-org-deployment");
  }, 15000);

  it("extracts and registers tests included in deployment YAML documents", async () => {
    const deploymentWithTests = `
name: deployment-with-tests
proxies:
  - name: test-proxy-with-tests
    endpoints:
      - basePath: /v1/test-target
        routes:
          - name: default
            target: default
tests:
  - name: test-status-200
    proxy: test-proxy-with-tests
    verb: POST
    headers:
      x-api-key: starter-app-key-123
    payload: '{"hello":"world"}'
    assertions:
      - status.code == 200
`;
    const result = await DeploymentManager.deploy(deploymentWithTests, { build: false });
    expect(result.importedTests).toContain("test-status-200");

    const proxyTests = DataManager.getTestsForProxy("test-proxy-with-tests");
    expect(proxyTests.length).toBeGreaterThanOrEqual(1);
    expect(proxyTests[0].name).toBe("test-status-200");
    expect(proxyTests[0].assertions).toContain("status.code == 200");
  });

  it("rebuild compiles all proxies and generates updated index.ts with deployment endpoints", async () => {
    const buildRes = await runBuild();
    expect(buildRes.success).toBe(true);
    expect(buildRes.count).toBeGreaterThan(0);

    const indexContent = fs.readFileSync(path.join(process.cwd(), "index.ts"), "utf8");
    expect(indexContent).toContain("/api/deployments");
    expect(indexContent).toContain("DeploymentManager.deploy");
    expect(indexContent).toContain("DataManager.initialize");
    expect(indexContent).toContain("/api/products");
    expect(indexContent).toContain("/api/users");
  }, 15000);
});
