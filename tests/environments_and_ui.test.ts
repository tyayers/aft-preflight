import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { DataManager } from "../lib/DataManager";
import { DeploymentManager } from "../lib/DeploymentManager";
import { runBuild } from "../build";

describe("Bungee Runtime Single Environment & Web App Suite", () => {
  beforeAll(async () => {
    await DataManager.initialize();
    await runBuild();
  });

  afterAll(async () => {
    // Cleanup any temporary files created during testing
    DataManager.deleteDataFile("proxies", "test-single-env-proxy.yaml");
    DataManager.deleteDataFile("deployments", "test-single-env-deployment.yaml");
    await runBuild();
  });

  it("verifies top-level data directories and summary", () => {
    const summary = DataManager.getDataSummary();
    expect(summary).toBeDefined();
    expect(summary.counts).toBeDefined();
    expect(summary.files).toBeDefined();
    expect(summary.files.proxies).toBeDefined();
    expect(summary.files.deployments).toBeDefined();
    expect(summary.files.products).toBeDefined();
    expect(summary.files.kvm).toBeDefined();
    expect(summary.files.users).toBeDefined();

    // Verify top-level data directory paths
    expect(fs.existsSync(DataManager.proxiesDir)).toBe(true);
    expect(fs.existsSync(DataManager.deploymentsDir)).toBe(true);
    expect(fs.existsSync(DataManager.productsDir)).toBe(true);
    expect(fs.existsSync(DataManager.kvmDir)).toBe(true);
    expect(fs.existsSync(DataManager.usersDir)).toBe(true);

    // Verify data/environments does not exist
    expect(fs.existsSync(path.join(process.cwd(), "data", "environments"))).toBe(false);
  });

  it("saves, lists, reads, and deletes top-level data configuration files", () => {
    const sampleProxyYaml = `name: test-single-env-proxy
endpoints:
  - name: default
    basePath: /single-env-test
    routes:
      - target: default
targets:
  - name: default
    url: https://httpbin.org/get
`;

    const saved = DataManager.saveDataFile("proxies", "test-single-env-proxy.yaml", sampleProxyYaml);
    expect(saved).toBe(true);

    const files = DataManager.listDataFiles("proxies");
    expect(files).toContain("test-single-env-proxy.yaml");

    const readBack = DataManager.getDataFile("proxies", "test-single-env-proxy.yaml");
    expect(readBack).toBe(sampleProxyYaml);

    // Verify file exists directly under data/proxies/
    expect(fs.existsSync(path.join(DataManager.proxiesDir, "test-single-env-proxy.yaml"))).toBe(true);
  });

  it("deploys a deployment file directly into runtime without environment prefix", async () => {
    const sampleDeploymentYaml = `name: test-single-env-deployment
description: Single environment test deployment

products:
  - name: single-env-product
    displayName: Single Env Product
    proxies:
      - test-runtime-proxy

proxies:
  - name: test-runtime-proxy
    endpoints:
      - name: default
        basePath: /test-runtime-endpoint
        routes:
          - target: default
    targets:
      - name: default
        url: https://httpbin.org/anything
`;

    const result = await DeploymentManager.deploy(sampleDeploymentYaml);
    expect(result.success).toBe(true);
    expect(result.deployedProxies.some((p) => p.name === "test-runtime-proxy")).toBe(true);

    // Verify proxy file was written in data/proxies/ and compiled in ./proxies/
    expect(fs.existsSync(path.join(DataManager.proxiesDir, "test-runtime-proxy.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(DataManager.deploymentsDir, "test-single-env-deployment.yaml"))).toBe(true);
    expect(fs.existsSync("./proxies/test-runtime-proxy.ts")).toBe(true);

    // Verify index.ts mounts at /test-runtime-endpoint directly without environment prefix
    const indexContent = fs.readFileSync("./index.ts", "utf8");
    expect(indexContent).toContain('"/test-runtime-endpoint/*"');
    expect(indexContent).not.toContain('"/dev/test-runtime-endpoint"');

    // Clean up temporary deployment proxy
    DataManager.deleteDataFile("proxies", "test-runtime-proxy.yaml");
    DataManager.deleteDataFile("deployments", "test-single-env-deployment.yaml");
  });

  it("verifies public/ static assets exist and are valid for AFT TESTPILOT Runtime Explorer & Tester", async () => {
    expect(fs.existsSync("./public/index.html")).toBe(true);
    expect(fs.existsSync("./public/style.css")).toBe(true);
    expect(fs.existsSync("./public/app.js")).toBe(true);

    const html = fs.readFileSync("./public/index.html", "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("AFT TESTPILOT");
    expect(html).toContain("RUNTIME EXPLORER & TESTER");
    expect(html).toContain("Test Console");
    expect(html).toContain("Live Traces");
    // Verify envModal is removed
    expect(html).not.toContain('id="envModal"');
    expect(html).not.toContain('id="envSelectorBtn"');

    const css = fs.readFileSync("./public/style.css", "utf8");
    expect(css).toContain("--bg-app");
    expect(css).toContain("[data-theme=\"dark\"]");
    expect(css).toContain(".sidebar-nav");
    expect(css).toContain(".tester-container");

    const js = fs.readFileSync("./public/app.js", "utf8");
    expect(js).toContain("executeTestRequest");
    expect(js).toContain("renderTraceWaterfall");
    expect(js).toContain("loadRuntimeData");
    expect(js).toContain("exportTrace");
    expect(js).not.toContain("generateRandomEnvName");
    expect(js).not.toContain("loadEnvironment");
  });
});
