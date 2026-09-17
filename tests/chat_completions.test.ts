import { describe, expect, it, beforeAll } from "bun:test";
import { RESTAICompletionsProxy } from "../proxies/REST-AI-Completions";
import { DataManager } from "../lib/DataManager";
import { getCachedProjectId } from "../lib/googleAuth";

describe("REST-AI-Completions Proxy Route and Traffic Processing", () => {
  beforeAll(async () => {
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
    // Real call will return Google Cloud response (200 or 403 with GCP error details)
    const text = await res.text();
    expect([200, 403]).toContain(res.status);
    expect(text.length).toBeGreaterThan(2);
    expect(text).not.toBe("{}");
  });
});
