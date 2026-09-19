import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { AnalyticsManager } from "../lib/analytics";

describe("Live Server HTTP Endpoints & UI Delivery", () => {
  let serverProcess: any;
  const baseUrl = "http://localhost:3088";

  beforeAll(async () => {
    // Start index.ts server on port 3088
    serverProcess = Bun.spawn(["bun", "index.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: "3088" },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to be ready
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`${baseUrl}/api/data`);
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(ready).toBe(true);
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  it("serves SPA index.html at root /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("AFT PREFLIGHT");
    expect(text).toContain("BUNGEE RUNTIME");
  });

  it("serves static assets /style.css and /app.js", async () => {
    const cssRes = await fetch(`${baseUrl}/style.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get("content-type")).toContain("text/css");

    const jsRes = await fetch(`${baseUrl}/app.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get("content-type")).toContain("javascript");
  });

  it("serves data API /api/data", async () => {
    const res = await fetch(`${baseUrl}/api/data`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts).toBeDefined();
    expect(data.files).toBeDefined();
    expect(data.files.proxies).toBeDefined();
    expect(data.files.deployments).toBeDefined();
  });

  it("serves products and users APIs", async () => {
    const prodRes = await fetch(`${baseUrl}/api/products`);
    expect(prodRes.status).toBe(200);
    const products = await prodRes.json();
    expect(Array.isArray(products)).toBe(true);

    const userRes = await fetch(`${baseUrl}/api/users`);
    expect(userRes.status).toBe(200);
    const users = await userRes.json();
    expect(Array.isArray(users)).toBe(true);
  });

  it("handles POST /rebuild to rebuild and restart service", async () => {
    const res = await fetch(`${baseUrl}/rebuild`, { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toContain("Build successful");
    expect(json.count).toBeGreaterThanOrEqual(0);
  });

  it("serves GET /api/analytics and handles POST /api/analytics", async () => {
    // 1. Test POST /api/analytics
    const testRecord = {
      traceId: "test-server-e2e-" + Date.now(),
      proxyName: "test-proxy",
      clientReceivedStart: Date.now(),
      totalResponseTime: 42,
      targetResponseTime: 38,
      status: 200,
      clientRequest: {
        verb: "POST",
        uri: "/v1/chat/completions",
      },
      clientResponse: {
        status: 200,
        reason: "OK",
      },
      aiVariables: {
        "ai.model": "gemini-2.5-flash",
        "ai.prompt_tokens": 12,
        "ai.completion_tokens": 48,
        "ai.total_tokens": 60,
      },
      summary: {
        model: "gemini-2.5-flash",
        promptTokens: 12,
        completionTokens: 48,
        totalTokens: 60,
      },
    };

    const postRes = await fetch(`${baseUrl}/api/analytics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testRecord),
    });
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.success).toBe(true);
    expect(postJson.record).toBeDefined();
    expect(postJson.record.traceId).toBe(testRecord.traceId);

    // 2. Test GET /api/analytics
    const getRes = await fetch(`${baseUrl}/api/analytics?limit=10`);
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.success).toBe(true);
    expect(Array.isArray(getJson.records)).toBe(true);
    expect(getJson.count).toBeGreaterThanOrEqual(1);

    // Clean up created record in Firestore
    if (postJson.record?.id) {
      await AnalyticsManager.deleteRecord(postJson.record.id);
    }
  });
});
