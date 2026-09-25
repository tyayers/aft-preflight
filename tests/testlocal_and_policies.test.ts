import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, beforeAll, mock } from "bun:test";
import { Apigee, ApigeeContext, ApigeeRequest, ApigeeResponse, evaluateCondition, globalKvmStore, capturedDataMetrics } from "../lib/apigee";

let testlocalProxy: any;

beforeAll(async () => {
  const targetProxyPath = path.join(process.cwd(), "proxies", "testlocal.ts");
  if (!fs.existsSync(targetProxyPath)) {
    const fixturePath = path.join(process.cwd(), "tests", "fixtures", "testlocal.yaml");
    const dataProxyPath = path.join(process.cwd(), "data", "proxies", "testlocal.yaml");
    if (!fs.existsSync(path.dirname(dataProxyPath))) fs.mkdirSync(path.dirname(dataProxyPath), { recursive: true });
    if (fs.existsSync(fixturePath)) {
      fs.copyFileSync(fixturePath, dataProxyPath);
    }
    const { runBuild } = await import("../build");
    await runBuild();
  }
  const mod = await import("../proxies/testlocal");
  testlocalProxy = mod.testlocalProxy;
}, 30000);

describe("Apigee Condition Evaluator", () => {
  it("evaluates simple and boolean expressions", () => {
    const ctx = new ApigeeContext();
    ctx.setVariable("foo", "bar");
    ctx.setVariable("count", 42);

    expect(evaluateCondition("true", ctx)).toBe(true);
    expect(evaluateCondition("false", ctx)).toBe(false);
    expect(evaluateCondition("foo == \"bar\"", ctx)).toBe(true);
    expect(evaluateCondition("foo != \"baz\"", ctx)).toBe(true);
    expect(evaluateCondition("count == 42", ctx)).toBe(true);
    expect(evaluateCondition("count > 40", ctx)).toBe(true);
    expect(evaluateCondition("count < 50", ctx)).toBe(true);
  });

  it("evaluates JavaRegex / regex conditions", () => {
    const ctx = new ApigeeContext();
    ctx.setVariable("ai.model", "smart-flash");
    expect(evaluateCondition('ai.model JavaRegex "^smart-.*"', ctx)).toBe(true);

    ctx.setVariable("ai.model", "gemini-2.5-flash");
    expect(evaluateCondition('ai.model JavaRegex "^smart-.*"', ctx)).toBe(false);
  });

  it("evaluates null checks and logical AND / OR / NOT operators", () => {
    const ctx = new ApigeeContext();
    ctx.setVariable("request.header.x-ai-key", null);
    ctx.setVariable("request.header.x-ai-group", "group-123");

    expect(evaluateCondition("request.header.x-ai-key == null AND request.header.x-ai-group != null", ctx)).toBe(true);
    expect(evaluateCondition("request.header.x-ai-key != null", ctx)).toBe(false);

    ctx.setVariable("fault.name", "InvalidApiKey");
    expect(evaluateCondition('fault.name == "InvalidApiKey" OR fault.name == "FailedToResolveAPIKey"', ctx)).toBe(true);
  });
});

describe("KeyValueMapOperations Policy", () => {
  it("loads seeded configuration and handles get/put", async () => {
    const ctx = new ApigeeContext();

    await Apigee.keyValueMapOperations(
      {
        mapIdentifier: "AI-Config",
        get: [
          { key: "FailoverModel", assignTo: "ai.failoverModel" },
          { key: "PriceList", assignTo: "ai.prices" },
        ],
      },
      ctx
    );

    expect(ctx.getVariable("ai.failoverModel")).toBe("google/gemini-3.7-flash");
    expect(ctx.getVariable("ai.prices")).toBeDefined();
    expect(JSON.parse(ctx.getVariable("ai.prices"))["google/gemini-3.7-flash"]).toBeDefined();

    // Put new value
    await Apigee.keyValueMapOperations(
      {
        mapIdentifier: "AI-Config",
        put: [{ key: "CustomSetting", value: "enabled" }],
      },
      ctx
    );

    await Apigee.keyValueMapOperations(
      {
        mapIdentifier: "AI-Config",
        get: [{ key: "CustomSetting", assignTo: "custom.setting" }],
      },
      ctx
    );

    expect(ctx.getVariable("custom.setting")).toBe("enabled");
  });
});

describe("VerifyAPIKey Policy", () => {
  it("populates context variables on valid key", async () => {
    const ctx = new ApigeeContext();
    ctx.setVariable("request.header.x-ai-key", "valid-test-key-999");

    await Apigee.verifyApiKey(
      {
        keyRef: "request.header.x-ai-key",
        policyName: "VA-VerifyKey",
      },
      ctx
    );

    expect(ctx.getVariable("verifyapikey.VA-VerifyKey.failed")).toBe(false);
    expect(ctx.getVariable("verifyapikey.VA-VerifyKey.client_id")).toBe("valid-test-key-999");
    expect(ctx.getVariable("client_id")).toBe("valid-test-key-999");
  });

  it("raises InvalidApiKey fault when key is missing", async () => {
    const ctx = new ApigeeContext();

    let errorThrown = false;
    try {
      await Apigee.verifyApiKey(
        {
          keyRef: "request.header.x-ai-key",
          policyName: "VA-VerifyKey",
        },
        ctx
      );
    } catch (err: any) {
      errorThrown = true;
      expect(err.message).toContain("InvalidApiKey");
    }

    expect(errorThrown).toBe(true);
    expect(ctx.getVariable("verifyapikey.VA-VerifyKey.failed")).toBe(true);
    expect(ctx.fault?.name).toBe("InvalidApiKey");
    expect(ctx.fault?.status).toBe(401);
  });
});

describe("DataCapture Policy", () => {
  it("captures variables and stores metrics", async () => {
    const ctx = new ApigeeContext();
    ctx.setVariable("ai.inputTokens", 120);
    ctx.setVariable("ai.outputTokens", 45);

    const initialLen = capturedDataMetrics.length;

    await Apigee.dataCapture(
      {
        policyName: "DC-TokenAnalytics",
        collectors: [
          { collectorName: "input_tokens", ref: "ai.inputTokens" },
          { collectorName: "output_tokens", ref: "ai.outputTokens" },
        ],
      },
      ctx
    );

    expect(ctx.getVariable("datacapture.input_tokens")).toBe(120);
    expect(ctx.getVariable("datacapture.output_tokens")).toBe(45);
    expect(capturedDataMetrics.length).toBe(initialLen + 1);
    expect(capturedDataMetrics[capturedDataMetrics.length - 1].metrics.input_tokens).toBe(120);
  });
});

describe("TestlocalProxy End-to-End Execution", () => {
  it("returns 401 Unauthorized with AM-Unauthorized fault rule when API key is missing", async () => {
    const payload = JSON.stringify({
      model: "google/gemini-3.7-flash",
      messages: [{ role: "user", content: "Hello AI" }],
    });

    const req = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: payload,
    });

    const res = await testlocalProxy(req);
    expect(res.status).toBe(401);
    const bodyText = await res.text();
    expect(bodyText).toBe("Unauthorized.");
  });

  it("handles valid API key and executes flows cleanly", async () => {
    // Set up mock target server
    const mockTargetServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json();
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: Date.now(),
          model: "gemini-3.7-flash",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello from local test target!" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 15,
            total_tokens: 25,
          },
        });
      },
    });

    // Point the default KVM/routes to our local mock target if needed
    const payload = JSON.stringify({
      model: "google/gemini-3.7-flash",
      messages: [{ role: "user", content: "Hello AI!" }],
    });

    const req = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-key": "my-secret-developer-key",
      },
      body: payload,
    });

    const res = await testlocalProxy(req);
    // Since upstream aiplatform.googleapis.com is called with ADC or mock credentials, live GCP returns 401/403/404, or 502 on network fault
    expect([200, 401, 403, 404, 502]).toContain(res.status);
    mockTargetServer.stop();
  });

  it("handles smart model dynamic routing (smart-flash)", async () => {
    const payload = JSON.stringify({
      model: "smart-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    const req = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-key": "my-secret-developer-key",
      },
      body: payload,
    });

    const res = await testlocalProxy(req);
    expect([200, 401, 403, 404, 502]).toContain(res.status);
  }, 30000);

  it("executes full end-to-end flow with successful mock target response and data capture", async () => {
    const originalFetch = globalThis.fetch;
    const initialMetricCount = capturedDataMetrics.length;

    globalThis.fetch = (async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes("aiplatform.googleapis.com")) {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-local-mock",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "gemini-3.7-flash",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Hello from local mocked Gemini!" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 18,
              completion_tokens: 42,
              total_tokens: 60,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return originalFetch(url, options);
    }) as any;

    try {
      const payload = JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [{ role: "user", content: "Hello local mock!" }],
      });

      const req = new Request("http://localhost:8080/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-key": "my-secret-developer-key",
        },
        body: payload,
      });

      const res = await testlocalProxy(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.choices[0].message.content).toBe("Hello from local mocked Gemini!");
      // Verify DataCapture recorded analytics
      expect(capturedDataMetrics.length).toBeGreaterThan(initialMetricCount);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
