import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, beforeAll } from "bun:test";
import { TraceManager } from "../lib/tracer";
import { ApigeeContext } from "../lib/apigee";

let sample_proxyProxy: any;

beforeAll(async () => {
  const targetProxyPath = path.join(process.cwd(), "proxies", "sample-proxy.ts");
  if (!fs.existsSync(targetProxyPath)) {
    const fixturePath = path.join(process.cwd(), "tests", "fixtures", "sample-proxy.yaml");
    const dataProxyPath = path.join(process.cwd(), "data", "proxies", "sample-proxy.yaml");
    if (!fs.existsSync(path.dirname(dataProxyPath))) fs.mkdirSync(path.dirname(dataProxyPath), { recursive: true });
    if (fs.existsSync(fixturePath)) {
      fs.copyFileSync(fixturePath, dataProxyPath);
    }
    const { runBuild } = await import("../build");
    await runBuild();
  }
  const mod = await import("../proxies/sample-proxy");
  sample_proxyProxy = mod.sample_proxyProxy;
});

describe("Tracing & Profiling Engine", () => {
  beforeEach(() => {
    TraceManager.clearTraces();
    TraceManager.setTracingEnabled(true);
    delete process.env.DISABLE_TRACING;
    delete process.env.BUNGEE_TRACING;
    delete process.env.TRACING_ENABLED;
    delete process.env.ENABLE_TRACING;
  });

  it("tracing is enabled by default and disabled via environment variables or programmatically", () => {
    expect(TraceManager.isTracingEnabled()).toBe(true);

    process.env.DISABLE_TRACING = "true";
    expect(TraceManager.isTracingEnabled()).toBe(false);

    delete process.env.DISABLE_TRACING;
    process.env.BUNGEE_TRACING = "false";
    expect(TraceManager.isTracingEnabled()).toBe(false);

    delete process.env.BUNGEE_TRACING;
    TraceManager.setTracingEnabled(false);
    expect(TraceManager.isTracingEnabled()).toBe(false);

    TraceManager.setTracingEnabled(true);
    expect(TraceManager.isTracingEnabled()).toBe(true);
  });

  it("records step execution with timings and saves all variables in step snapshots", async () => {
    const req = new Request("http://localhost:8080/sample", {
      method: "GET",
      headers: { "x-test-header": "test-val" },
    });

    const context = new ApigeeContext(req, {}, "test-proxy");
    expect(context.trace).toBeDefined();

    context.setVariable("custom.initial.var", "hello");

    await context.traceStep("AM-TestStep", "AssignMessage", "Request Flow", async () => {
      context.setVariable("my.var", "123");
      context.setVariable("my.nested.object", { foo: "bar", count: 42 });
    });

    context.recordSkippedStep("JS-Skipped", "Javascript", "Request Flow", "condition == false");

    context.recordTargetCall({
      name: "default",
      url: "https://mocktarget.apigee.net",
      verb: "GET",
      status: 200,
      durationMs: 45,
    });

    context.response.status = 200;
    context.response.content = JSON.stringify({ ok: true });
    const trace = context.finalizeTrace();

    expect(trace).toBeDefined();
    expect(trace?.proxyName).toBe("test-proxy");
    expect(trace?.steps.length).toBe(2);
    expect(trace?.steps[0].name).toBe("AM-TestStep");
    expect(trace?.steps[0].status).toBe("SUCCESS");
    expect(trace?.steps[0].durationMs).toBeGreaterThanOrEqual(0.05);

    // Verify all variables saved in trace step snapshot
    expect(trace?.steps[0].variablesSnapshot).toBeDefined();
    expect(trace?.steps[0].variablesSnapshot?.["custom.initial.var"]).toBe("hello");
    expect(trace?.steps[0].variablesSnapshot?.["my.var"]).toBe("123");
    expect(trace?.steps[0].variablesSnapshot?.["my.nested.object"]).toEqual({ foo: "bar", count: 42 });

    // Verify skipped step also captured snapshot
    expect(trace?.steps[1].name).toBe("JS-Skipped");
    expect(trace?.steps[1].status).toBe("SKIPPED");
    expect(trace?.steps[1].variablesSnapshot?.["my.var"]).toBe("123");

    // Verify proxy & target timings
    expect(trace?.targetDurationMs).toBe(45);
    expect(trace?.proxyDurationMs).toBeGreaterThanOrEqual(0);

    expect(context.response.getHeader("x-bungee-trace-id")).toBe(trace!.id);
  });

  it("formats trace into Apigee Trace/Debug structure matching cloud export", async () => {
    const req = new Request("http://localhost:8080/sample", { method: "GET" });
    const context = new ApigeeContext(req, {}, "sample-proxy");
    context.setVariable("client.ip", "127.0.0.1");
    await context.traceStep("AM-1", "AssignMessage", "Request Flow", async () => {
      context.setVariable("test.step.var", "step-value");
    });
    context.recordTargetCall({
      name: "default",
      url: "https://mocktarget.apigee.net",
      verb: "GET",
      status: 200,
      durationMs: 45,
    });
    const trace = context.finalizeTrace()!;

    const apigeeTrace = TraceManager.toApigeeTrace(trace);

    // Root schema matching tests/trace-example-cloud.json
    expect(apigeeTrace.DebugSession).toBeDefined();
    expect(apigeeTrace.DebugSession.API).toBe("sample-proxy");
    expect(apigeeTrace.DebugSession.SessionId).toBe(trace.id);
    expect(apigeeTrace.DebugSession.Version).toBe("2.1");
    expect(Array.isArray(apigeeTrace.Messages)).toBe(true);
    expect(apigeeTrace.Messages[0].completed).toBe(true);

    const points = apigeeTrace.Messages[0].point;
    expect(Array.isArray(points)).toBe(true);

    const pointIds = points.map((p: any) => p.id);
    expect(pointIds).toContain("StateChange");
    expect(pointIds).toContain("FlowInfo");
    expect(pointIds).toContain("Execution");
    expect(pointIds).toContain("Paused");
    expect(pointIds).toContain("Resumed");

    // Check Execution point schema (12 keys matching cloud export)
    const execPoint = points.find((p: any) => p.id === "Execution");
    expect(execPoint).toBeDefined();
    expect(Array.isArray(execPoint.results)).toBe(true);

    const debugInfoResult = execPoint.results.find((r: any) => r.actionResult === "DebugInfo");
    expect(debugInfoResult).toBeDefined();
    expect(debugInfoResult.ActionResult).toBe("DebugInfo");
    expect(debugInfoResult.properties.properties).toBeDefined();
    expect(debugInfoResult.properties.property).toBeDefined();

    const varAccessResult = execPoint.results.find((r: any) => r.actionResult === "VariableAccess");
    expect(varAccessResult).toBeDefined();
    expect(Array.isArray(varAccessResult.accessList)).toBe(true);

    const foundVar = varAccessResult.accessList.find((a: any) => a.set && a.set.name === "test.step.var");
    expect(foundVar).toBeDefined();
    expect(foundVar.set.value).toBe("step-value");
  });

  it("formats trace into OpenTelemetry (OTEL) ResourceSpans structure", async () => {
    const req = new Request("http://localhost:8080/sample", { method: "POST" });
    const context = new ApigeeContext(req, {}, "sample-proxy");
    await context.traceStep("AM-1", "AssignMessage", "Request Flow", async () => {
      context.setVariable("otel.test.var", "otel-value");
    });
    context.recordTargetCall({
      name: "default",
      url: "https://mocktarget.apigee.net",
      verb: "POST",
      status: 200,
      durationMs: 30,
    });
    const trace = context.finalizeTrace()!;

    const otelTrace = TraceManager.toOtelTrace(trace);
    expect(otelTrace.resourceSpans).toBeDefined();
    expect(otelTrace.resourceSpans[0].resource.attributes.find((a: any) => a.key === "service.name")?.value.stringValue).toBe("aft-preflight");
    expect(otelTrace.resourceSpans[0].scopeSpans).toBeDefined();

    const spans = otelTrace.resourceSpans[0].scopeSpans[0].spans;
    expect(spans.length).toBeGreaterThanOrEqual(3); // root span + step span + target span

    // Root span
    const rootSpan = spans.find((s: any) => s.kind === 2);
    expect(rootSpan).toBeDefined();
    expect(rootSpan.traceId).toBe(trace.id);
    expect(rootSpan.name).toBe("POST /sample");
    expect(rootSpan.parentSpanId).toBe("");
    expect(rootSpan.attributes.find((a: any) => a.key === "apigee.proxy")?.value.stringValue).toBe("sample-proxy");
    expect(rootSpan.attributes.find((a: any) => a.key === "http.status_code")?.value.intValue).toBe("200");

    // Step span
    const stepSpan = spans.find((s: any) => s.name === "Step: AM-1");
    expect(stepSpan).toBeDefined();
    expect(stepSpan.kind).toBe(1);
    expect(stepSpan.parentSpanId).toBe(rootSpan.spanId);
    expect(stepSpan.attributes.find((a: any) => a.key === "apigee.variable.otel.test.var")?.value.stringValue).toBe("otel-value");

    // Target span
    const targetSpan = spans.find((s: any) => s.kind === 3);
    expect(targetSpan).toBeDefined();
    expect(targetSpan.name).toBe("Target: default");
    expect(targetSpan.parentSpanId).toBe(rootSpan.spanId);
    expect(targetSpan.attributes.find((a: any) => a.key === "http.url")?.value.stringValue).toBe("https://mocktarget.apigee.net");
  });

  it("sets x-bungee-trace-id header on real proxy call", async () => {
    const req = new Request("http://localhost:8080/sample", { method: "GET" });
    const res = await sample_proxyProxy(req);
    const traceId = res.headers.get("x-bungee-trace-id");
    expect(traceId).toBeTruthy();

    const storedTrace = TraceManager.getTrace(traceId!);
    expect(storedTrace).toBeDefined();
    expect(storedTrace?.proxyName).toBe("sample-proxy");
  });

  it("captures request headers, request payload, response headers, and response payload in trace", async () => {
    const req = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer secret-token",
        "x-custom-req-id": "req-999",
      },
      body: JSON.stringify({ prompt: "Hello world", temperature: 0.7 }),
    });

    const context = new ApigeeContext(req, {}, "test-ai-proxy");
    context.request.content = JSON.stringify({ prompt: "Hello world", temperature: 0.7 });

    await context.traceStep("AM-SetHeaders", "AssignMessage", "Request Flow", async () => {
      context.request.setHeader("x-added-by-policy", "added-val");
    });

    context.response.status = 200;
    context.response.setHeader("content-type", "application/json");
    context.response.setHeader("x-response-meta", "trace-test");
    context.response.content = { choices: [{ message: { content: "Hi there!" } }] };

    const trace = context.finalizeTrace();
    expect(trace).toBeDefined();

    // Verify request headers & payload
    expect(trace?.request.verb).toBe("POST");
    expect(trace?.request.headers["authorization"]).toBe("Bearer secret-token");
    expect(trace?.request.headers["x-custom-req-id"]).toBe("req-999");
    expect(trace?.request.headers["x-added-by-policy"]).toBe("added-val");
    expect(trace?.request.body).toContain("Hello world");
    expect(JSON.parse(trace!.request.body!).prompt).toBe("Hello world");

    // Verify response headers & payload
    expect(trace?.response.status).toBe(200);
    expect(trace?.response.headers["content-type"]).toBe("application/json");
    expect(trace?.response.headers["x-response-meta"]).toBe("trace-test");
    expect(trace?.response.body).toContain("Hi there!");
    expect(JSON.parse(trace!.response.body!).choices[0].message.content).toBe("Hi there!");
  });

  it("accumulates all streaming response chunks into trace response body and preserves payload", async () => {
    const req = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-3.7-flash", stream: true }),
    });

    const context = new ApigeeContext(req, {}, "streaming-proxy");
    context.response.setHeader("content-type", "text/event-stream; charset=utf-8");

    // Finalize trace initially when headers are ready (as done before streaming response begins)
    const trace = context.finalizeTrace();
    expect(trace).toBeDefined();

    // Chunks arrive dynamically
    context.appendStreamChunk("data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n");
    context.appendStreamChunk("data: {\"choices\":[{\"delta\":{\"content\":\" world!\"}}]}\n\n");
    context.appendStreamChunk("data: [DONE]\n\n");

    // Finalize stream trace
    context.finalizeStreamTrace();

    expect(trace?.response.body).toBeDefined();
    expect(trace?.response.body).toContain("Hello");
    expect(trace?.response.body).toContain("world!");
    expect(trace?.response.body).toContain("[DONE]");

    // Verify stored trace in TraceManager also has the full streaming payload
    const retrieved = TraceManager.getTrace(trace!.id);
    expect(retrieved?.response.body).toBe(trace?.response.body);

    // Verify Apigee Trace conversion includes the streamed payload
    const apigeeTrace = TraceManager.toApigeeTrace(trace!);
    const points = apigeeTrace.Messages[0].point;
    const responseMessages = points.filter((p: any) =>
      p.results?.some((r: any) => r.actionResult === "ResponseMessage")
    );
    expect(responseMessages.length).toBeGreaterThan(0);
    const content = responseMessages[0].results.find((r: any) => r.actionResult === "ResponseMessage").content;
    expect(content).toContain("world!");
  });
});
