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
    expect(aiConfig?.GeminiApiKey).toBe("{GEMINI_API_KEY}");
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
});
