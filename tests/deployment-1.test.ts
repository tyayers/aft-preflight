import { describe, it, expect, beforeAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runBuild } from "../build";
import { DataManager } from "../lib/DataManager";

describe("Deployment-1 End-to-End Build and Execution", () => {
  beforeAll(async () => {
    // 1. Build from data/deployments/deployment-1.yaml
    const buildRes = await runBuild();
    expect(buildRes.success).toBe(true);

    // 2. Initialize DataManager
    await DataManager.initialize();
  }, 30000);

  it("compiles TestProxy without naming collisions", async () => {
    const testProxyPath = path.join(process.cwd(), "proxies", "TestProxy.ts");
    expect(fs.existsSync(testProxyPath)).toBe(true);

    const mod = await import("../proxies/TestProxy");
    expect(typeof mod.TestProxyProxy).toBe("function");
    expect(typeof mod.TestProxyProxyClass).toBe("function");
    expect(mod.TestProxyInstance).toBeDefined();
  });

  it("executes TestProxy GET request and applies policies", async () => {
    const { TestProxyProxy } = await import("../proxies/TestProxy");

    const req = new Request("http://localhost:8080/testproxy", {
      method: "GET",
    });

    const res = await TestProxyProxy(req);
    expect(res.status).toBe(200);

    // Assert that AM-SetHeader set x-testheader
    expect(res.headers.get("x-testheader")).toBe("Hello world!");

    // Assert that JS-AddHelloWorld appended the message
    const body = await res.text();
    expect(body).toContain("Hello world!");
  });

  it("loads kvms array from deployment-1.yaml into DataManager and global store", () => {
    const aiConfig = DataManager.getKvm("AI-Config");
    expect(aiConfig).toBeDefined();
    const expectedKey = process.env.GEMINI_API_KEY || "{GEMINI_API_KEY}";
    expect(aiConfig?.GeminiApiKey).toBe(expectedKey);
  });

  it("loads products and users from deployment-1.yaml into DataManager", () => {
    const product = DataManager.getProduct("test-product");
    expect(product).toBeDefined();
    expect(product?.name).toBe("test-product");
    expect(product?.proxies).toContain("TestProxy");

    const user = DataManager.getUser("test@example.com");
    expect(user).toBeDefined();
    expect(user?.email).toBe("test@example.com");
    expect(user?.apps?.[0]?.credentials?.[0]?.consumerKey).toBe("test-app-key-123");
  });

  it("registers tests defined in deployment-1.yaml", () => {
    const tests = DataManager.listTests();
    const testNames = tests.map((t) => t.name);
    expect(testNames).toContain("testproxy-test1");
    expect(testNames).toContain("interactions-test1");
    expect(testNames).toContain("completions-test1");
    expect(testNames).toContain("generatecontent-test1");

    const testProxyTests = DataManager.getTestsForProxy("TestProxy");
    expect(testProxyTests.length).toBeGreaterThanOrEqual(1);
    expect(testProxyTests[0].path).toBe("/testproxy");
    expect(testProxyTests[0].verb).toBe("GET");
  });

  it("replaceEnvVariables replaces {var} when set in process.env and preserves when unset", async () => {
    const { replaceEnvVariables } = await import("../build");

    const prevVar = process.env.TEST_CUSTOM_VAR;
    const prevGcp = process.env.GOOGLE_CLOUD_PROJECT;
    try {
      process.env.TEST_CUSTOM_VAR = "custom-val-99";
      process.env.GOOGLE_CLOUD_PROJECT = "test-project-xyz";

      // 1. Direct variable name match
      expect(replaceEnvVariables("Hello {TEST_CUSTOM_VAR}!")).toBe("Hello custom-val-99!");
      expect(replaceEnvVariables("Project is {GOOGLE_CLOUD_PROJECT}")).toBe("Project is test-project-xyz");

      // 2. Snake case / Pascal case conversion
      expect(replaceEnvVariables("Project is {GoogleCloudProject}")).toBe("Project is test-project-xyz");

      // 3. Unset variable is left unchanged
      delete process.env.SOME_UNSET_VAR_XYZ;
      expect(replaceEnvVariables("Unset: {SOME_UNSET_VAR_XYZ}")).toBe("Unset: {SOME_UNSET_VAR_XYZ}");

      // 4. Dot-separated flow variables or json blocks left untouched
      expect(replaceEnvVariables("{organization.name}")).toBe("{organization.name}");
      expect(replaceEnvVariables("{propertyset.helloworld.MESSAGE}")).toBe("{propertyset.helloworld.MESSAGE}");
      expect(replaceEnvVariables("try { let x = 1; }")).toBe("try { let x = 1; }");
    } finally {
      if (prevVar !== undefined) process.env.TEST_CUSTOM_VAR = prevVar;
      else delete process.env.TEST_CUSTOM_VAR;

      if (prevGcp !== undefined) process.env.GOOGLE_CLOUD_PROJECT = prevGcp;
      else delete process.env.GOOGLE_CLOUD_PROJECT;
    }
  });

  it("replaces {GOOGLE_CLOUD_PROJECT} when converting deployment-1.yaml during build", async () => {
    const prevGcp = process.env.GOOGLE_CLOUD_PROJECT;
    const prevApiKey = process.env.GEMINI_API_KEY;
    try {
      process.env.GOOGLE_CLOUD_PROJECT = "gcp-build-test-project-456";
      process.env.GEMINI_API_KEY = "build-test-gemini-key";

      // Re-run build with env variables set
      const buildRes = await runBuild();
      expect(buildRes.success).toBe(true);
      await DataManager.initialize();

      // Verify that test path has been converted with the env variable value
      const genTests = DataManager.getTestsForProxy("REST-AI-GenerateContent");
      expect(genTests.length).toBeGreaterThanOrEqual(1);
      const testPath = genTests[0].path;
      expect(testPath).toContain("/v1/projects/gcp-build-test-project-456/");
      expect(testPath).not.toContain("{GOOGLE_CLOUD_PROJECT}");

      // Verify generated proxy YAML in data/proxies/REST-AI-GenerateContent.yaml has the substituted project
      const proxyYamlPath = path.join(process.cwd(), "data", "proxies", "REST-AI-GenerateContent.yaml");
      expect(fs.existsSync(proxyYamlPath)).toBe(true);
      const proxyYamlContent = fs.readFileSync(proxyYamlPath, "utf8");
      expect(proxyYamlContent).toContain("gcp-build-test-project-456");
      expect(proxyYamlContent).not.toContain("{GOOGLE_CLOUD_PROJECT}");

      // Verify KVM in DataManager and data/kvm/AI-Config.yaml has the GeminiApiKey from env
      const aiConfig = DataManager.getKvm("AI-Config");
      expect(aiConfig?.GeminiApiKey).toBe("build-test-gemini-key");
    } finally {
      if (prevGcp !== undefined) process.env.GOOGLE_CLOUD_PROJECT = prevGcp;
      else delete process.env.GOOGLE_CLOUD_PROJECT;

      if (prevApiKey !== undefined) process.env.GEMINI_API_KEY = prevApiKey;
      else delete process.env.GEMINI_API_KEY;

      // Restore clean build state
      await runBuild();
      await DataManager.initialize();
    }
  }, 30000);
});

