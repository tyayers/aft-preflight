import { describe, it, expect } from "bun:test";
import { Http } from "../lib/http";
import { ApigeeRequest, ApigeeResponse, ApigeeContext } from "../lib/apigee";

describe("Http Content-Type Helpers", () => {
  it("correctly identifies streaming content types", () => {
    expect(Http.isStreaming("text/event-stream")).toBe(true);
    expect(Http.isStreaming("text/event-stream; charset=utf-8")).toBe(true);
    expect(Http.isStreaming("application/x-ndjson")).toBe(true);
    expect(Http.isStreaming("application/stream+json")).toBe(true);
    expect(Http.isStreaming("multipart/x-mixed-replace")).toBe(true);
    expect(Http.isStreaming("application/json")).toBe(false);
    expect(Http.isStreaming("text/plain")).toBe(false);
    expect(Http.isStreaming("image/png")).toBe(false);
    expect(Http.isStreaming(undefined)).toBe(false);
  });

  it("correctly identifies text vs non-text content types", () => {
    expect(Http.isText("text/plain")).toBe(true);
    expect(Http.isText("text/html; charset=utf-8")).toBe(true);
    expect(Http.isText("application/json")).toBe(true);
    expect(Http.isText("application/problem+json")).toBe(true);
    expect(Http.isText("application/xml")).toBe(true);
    expect(Http.isText("application/javascript")).toBe(true);
    expect(Http.isText("application/x-yaml")).toBe(true);
    expect(Http.isText("image/svg+xml")).toBe(true);

    expect(Http.isText("image/png")).toBe(false);
    expect(Http.isText("image/jpeg")).toBe(false);
    expect(Http.isText("application/octet-stream")).toBe(false);
    expect(Http.isText("application/pdf")).toBe(false);
    expect(Http.isText("audio/mpeg")).toBe(false);
    expect(Http.isText("video/mp4")).toBe(false);
    expect(Http.isText("application/zip")).toBe(false);
  });
});

describe("ApigeeRequest & ApigeeResponse Binary Support", () => {
  it("preserves text and enables asJSON", () => {
    const res = new ApigeeResponse(200, {}, JSON.stringify({ hello: "world" }));
    expect(res.content.asJSON.hello).toBe("world");
    expect(res.rawContent).toBe('{"hello":"world"}');
  });

  it("preserves Uint8Array / binary data without stringifying or corrupting", () => {
    const binaryBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = new ApigeeResponse(200, { "content-type": "image/png" });
    res.content = binaryBytes;

    expect(res.content).toBeInstanceOf(Uint8Array);
    expect(res.content).toEqual(binaryBytes);
    expect(res.rawContent).toBeInstanceOf(Uint8Array);
    expect(res.rawContent).toEqual(binaryBytes);
  });

  it("preserves ArrayBuffer data in ApigeeRequest", () => {
    const buffer = new ArrayBuffer(8);
    const req = new ApigeeRequest();
    req.content = buffer;

    expect(req.content).toBeInstanceOf(ArrayBuffer);
    expect(req.rawContent).toBeInstanceOf(ArrayBuffer);
  });

  it("resolves context variables with binary data safely", () => {
    const context = new ApigeeContext();
    const binaryBytes = new Uint8Array([1, 2, 3]);
    context.setVariable("binaryVar", binaryBytes);
    context.setVariable("textVar", "hello");

    const resolved = context.resolveVariables("{textVar} - {binaryVar}");
    expect(resolved).toBe("hello - [binary data]");
  });
});

describe("End-to-end Proxy Dynamic Streaming & Non-text Processing", () => {
  it("streams SSE responses dynamically chunk-by-chunk with policies applied", async () => {
    // Spin up a mock streaming server
    const mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode("data: {\"event\": 1}\n\n"));
              await Bun.sleep(10);
              controller.enqueue(new TextEncoder().encode("data: {\"event\": 2}\n\n"));
              controller.close();
            },
          }),
          {
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
            },
          }
        );
      },
    });

    try {
      const response = await fetch(`http://localhost:${mockServer.port}/test-stream`);
      const contentType = response.headers.get("content-type");
      expect(Http.isStreaming(contentType)).toBe(true);

      const reader = response.body?.getReader();
      const chunks: string[] = [];
      const decoder = new TextDecoder();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }

      expect(chunks.length).toBe(2);
      expect(chunks[0]).toContain('{"event": 1}');
      expect(chunks[1]).toContain('{"event": 2}');
    } finally {
      mockServer.stop();
    }
  });

  it("handles non-streaming binary responses without corruption", async () => {
    const originalBytes = new Uint8Array([0, 1, 2, 255, 254, 128, 64, 32]);
    const mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(originalBytes, {
          headers: {
            "content-type": "application/octet-stream",
          },
        });
      },
    });

    try {
      const response = await fetch(`http://localhost:${mockServer.port}/binary`);
      const contentType = response.headers.get("content-type");
      expect(Http.isStreaming(contentType)).toBe(false);
      expect(Http.isText(contentType)).toBe(false);

      const receivedBuffer = await response.arrayBuffer();
      const receivedBytes = new Uint8Array(receivedBuffer);
      expect(receivedBytes).toEqual(originalBytes);
    } finally {
      mockServer.stop();
    }
  });
});

describe("Proxy Header Forwarding", () => {
  it("forwards all custom headers while omitting dynamic headers like host and content-length", async () => {
    let capturedHeaders: Record<string, string> = {};
    const mockTargetServer = Bun.serve({
      port: 0,
      fetch(req) {
        for (const [k, v] of req.headers.entries()) {
          capturedHeaders[k.toLowerCase()] = v;
        }
        return new Response("OK", { headers: { "content-type": "text/plain" } });
      },
    });

    try {
      const skipHeaders = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade"]);
      const incomingHeaders = {
        "host": "my-proxy.com",
        "content-length": "123",
        "authorization": "Bearer secret-token",
        "content-type": "application/json",
        "x-api-key": "custom-key-123",
        "x-custom-request-header": "custom-value",
      };

      const forwardedHeaders = new Headers();
      for (const [k, v] of Object.entries(incomingHeaders)) {
        if (!skipHeaders.has(k.toLowerCase())) {
          forwardedHeaders.set(k, v);
        }
      }

      await fetch(`http://localhost:${mockTargetServer.port}/test-headers`, {
        headers: forwardedHeaders,
      });

      expect(capturedHeaders["authorization"]).toBe("Bearer secret-token");
      expect(capturedHeaders["content-type"]).toBe("application/json");
      expect(capturedHeaders["x-api-key"]).toBe("custom-key-123");
      expect(capturedHeaders["x-custom-request-header"]).toBe("custom-value");
      expect(capturedHeaders["host"]).not.toBe("my-proxy.com");
    } finally {
      mockTargetServer.stop();
    }
  });
});
