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
    delete process.env.DISABLE_TRACING;
    delete process.env.BUNGEE_TRACING;
  });

  it("tracing is enabled by default and disabled via environment variables", () => {
    expect(TraceManager.isTracingEnabled()).toBe(true);

    process.env.DISABLE_TRACING = "true";
    expect(TraceManager.isTracingEnabled()).toBe(false);

    delete process.env.DISABLE_TRACING;
    process.env.BUNGEE_TRACING = "false";
    expect(TraceManager.isTracingEnabled()).toBe(false);
  });

  it("records step execution with timings and variables", async () => {
    const req = new Request("http://localhost:8080/sample", {
      method: "GET",
      headers: { "x-test-header": "test-val" },
    });

    const context = new ApigeeContext(req, {}, "test-proxy");
    expect(context.trace).toBeDefined();

    await context.traceStep("AM-TestStep", "AssignMessage", "Request Flow", async () => {
      context.setVariable("my.var", "123");
    });

    context.recordSkippedStep("JS-Skipped", "Javascript", "Request Flow", "condition == false");

    context.response.status = 200;
    context.response.content = JSON.stringify({ ok: true });
    const trace = context.finalizeTrace();

    expect(trace).toBeDefined();
    expect(trace?.proxyName).toBe("test-proxy");
    expect(trace?.steps.length).toBe(2);
    expect(trace?.steps[0].name).toBe("AM-TestStep");
    expect(trace?.steps[0].status).toBe("SUCCESS");
    expect(trace?.steps[0].durationMs).toBeGreaterThanOrEqual(0.05);
    expect(trace?.steps[1].name).toBe("JS-Skipped");
    expect(trace?.steps[1].status).toBe("SKIPPED");
    expect(context.response.getHeader("x-bungee-trace-id")).toBe(trace!.id);
  });

  it("formats trace into Apigee Trace/Debug structure", async () => {
    const req = new Request("http://localhost:8080/sample", { method: "GET" });
    const context = new ApigeeContext(req, {}, "sample-proxy");
    await context.traceStep("AM-1", "AssignMessage", "Request Flow", async () => {});
    context.recordTargetCall({
      name: "default",
      url: "https://mocktarget.apigee.net",
      verb: "GET",
      status: 200,
      durationMs: 45,
    });
    const trace = context.finalizeTrace()!;

    const apigeeTrace = TraceManager.toApigeeTrace(trace);
    expect(apigeeTrace.traceId).toBe(trace.id);
    expect(apigeeTrace.proxyName).toBe("sample-proxy");
    expect(Array.isArray(apigeeTrace.point)).toBe(true);

    const pointIds = apigeeTrace.point.map((p: any) => p.id);
    expect(pointIds).toContain("ClientReceived");
    expect(pointIds).toContain("FlowExecution");
    expect(pointIds).toContain("TargetRequest");
    expect(pointIds).toContain("TargetResponse");
    expect(pointIds).toContain("ClientSent");
  });

  it("formats trace into OpenTelemetry (OTEL) ResourceSpans structure", async () => {
    const req = new Request("http://localhost:8080/sample", { method: "POST" });
    const context = new ApigeeContext(req, {}, "sample-proxy");
    await context.traceStep("AM-1", "AssignMessage", "Request Flow", async () => {});
    const trace = context.finalizeTrace()!;

    const otelTrace = TraceManager.toOtelTrace(trace);
    expect(otelTrace.resourceSpans).toBeDefined();
    expect(otelTrace.resourceSpans[0].scopeSpans).toBeDefined();

    const spans = otelTrace.resourceSpans[0].scopeSpans[0].spans;
    expect(spans.length).toBeGreaterThanOrEqual(2); // root span + step span
    expect(spans[0].traceId).toBe(trace.id);
    expect(spans[0].name).toBe("POST /sample");
    expect(spans[0].kind).toBe(2); // SPAN_KIND_SERVER
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);
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
});
