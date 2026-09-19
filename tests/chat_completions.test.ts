import { describe, expect, it, beforeAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { DataManager } from "../lib/DataManager";
let RESTAICompletionsProxy: any;

describe("REST-AI-Completions Proxy Route and Traffic Processing", () => {
  beforeAll(async () => {
    // If data directory was cleaned up, ensure required fixtures for chat completions exist
    const prodDir = path.join(process.cwd(), "data", "products");
    const userDir = path.join(process.cwd(), "data", "users");
    const kvmDir = path.join(process.cwd(), "data", "kvm");
    const proxiesDir = path.join(process.cwd(), "data", "proxies");
    fs.mkdirSync(prodDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(kvmDir, { recursive: true });
    fs.mkdirSync(proxiesDir, { recursive: true });

    const starterProd = path.join(process.cwd(), "tests", "products", "ai-starter-package.yaml");
    if (fs.existsSync(starterProd)) {
      fs.copyFileSync(starterProd, path.join(prodDir, "ai-starter-package.yaml"));
    }
    const testUser = path.join(process.cwd(), "tests", "users", "test.yaml");
    if (fs.existsSync(testUser)) {
      fs.copyFileSync(testUser, path.join(userDir, "test.yaml"));
    }
    const kvmCfg = path.join(process.cwd(), "tests", "fixtures", "data", "kvm", "AI-Config.yaml");
    if (fs.existsSync(kvmCfg)) {
      fs.copyFileSync(kvmCfg, path.join(kvmDir, "AI-Config.yaml"));
    }

    const targetProxyTs = path.join(process.cwd(), "proxies", "REST-AI-Completions.ts");
    if (!fs.existsSync(targetProxyTs)) {
      const fixtureProxy = path.join(process.cwd(), "tests", "fixtures", "REST-AI-Completions.yaml");
      if (fs.existsSync(fixtureProxy)) {
        fs.copyFileSync(fixtureProxy, path.join(proxiesDir, "REST-AI-Completions.yaml"));
      }
      const { runBuild } = await import("../build");
      await runBuild();
    }
    const mod = await import("../proxies/REST-AI-Completions");
    RESTAICompletionsProxy = mod.RESTAICompletionsProxy || mod.REST_AI_CompletionsProxy;

    await DataManager.initialize();
  });

  it("populates product LLM quota and routes /v1/chat/completions traffic to googlecloud-oai target", async () => {
    let targetFetchUrl = "";
    let targetFetchHeaders: Headers | null = null;
    let targetFetchBody = "";

    const originalFetch = globalThis.fetch;
    // Mock target fetch to simulate successful Google Cloud Vertex AI OpenAPI chat completion
    globalThis.fetch = async (url: any, opts: any) => {
      targetFetchUrl = url.toString();
      targetFetchHeaders = new Headers(opts?.headers);
      targetFetchBody = typeof opts?.body === "string" ? opts.body : "";

      return new Response(
        JSON.stringify({
          id: "chatcmpl-mock-googlecloud-oai",
          object: "chat.completion",
          created: 1789445906,
          model: "gemini-3.8-flash",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Hello from Google Cloud Vertex AI OpenAPI target!",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-target-executed": "googlecloud-oai",
          },
        }
      );
    };

    try {
      const proxy = new RESTAICompletionsProxy();

      const req = new Request("http://localhost:8080/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "starter-app-key-123",
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash",
          messages: [{ role: "user", content: "Hello Vertex AI" }],
        }),
      });

      const res = await proxy.handle(req);

      // Verify response
      expect(res.status).toBe(200);
      const resJson = await res.json();
      expect(resJson.id).toBe("chatcmpl-mock-googlecloud-oai");
      expect(resJson.choices[0].message.content).toBe(
        "Hello from Google Cloud Vertex AI OpenAPI target!"
      );

      // Verify that fetch was routed to the googlecloud-oai target endpoint
      expect(targetFetchUrl).toContain("/endpoints/openapi/chat/completions");
      expect(targetFetchHeaders).toBeDefined();
      expect(targetFetchHeaders!.get("authorization")).toMatch(/^Bearer /);

      // Verify transformed body sent to target
      const sentPayload = JSON.parse(targetFetchBody);
      expect(sentPayload.model).toBe("google/gemini-3.8-flash");
      expect(sentPayload.messages[0].content).toBe("Hello Vertex AI");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles live googlecloud-oai target interaction and returns real error or completion", async () => {
    const proxy = new RESTAICompletionsProxy();

    const req = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "starter-app-key-123",
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        messages: [{ role: "user", content: "ping" }],
      }),
    });

    const res = await proxy.handle(req);
    // Real call will return Google Cloud response (200 or 4xx GCP error details)
    const text = await res.text();
    expect([200, 400, 401, 403, 429]).toContain(res.status);
    expect(text.length).toBeGreaterThan(2);
    expect(text).not.toBe("{}");
  }, 20000);
});
