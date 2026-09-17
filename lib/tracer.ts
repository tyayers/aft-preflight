/**
 * AFT TESTPILOT - Lightweight Runtime Profiling & Tracing Engine
 *
 * Tracks execution steps, timings, variables, and target calls for every proxy invocation.
 * Supports exporting traces in Apigee Trace/Debug format and OpenTelemetry (OTEL) JSON format.
 * No external dependencies required.
 */

export interface TraceStep {
  id: string;
  name: string;
  type: string;
  flow: string;
  condition?: string;
  conditionResult?: boolean;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: "SUCCESS" | "SKIPPED" | "FAULT";
  error?: string;
  variablesSnapshot?: Record<string, any>;
}

export interface ExecutionTrace {
  id: string; // 32 hex characters (OTEL traceId)
  spanId: string; // 16 hex characters
  proxyName: string;
  timestamp: number;
  durationMs: number;
  clientReceivedTime: number;
  clientSentTime: number;
  request: {
    verb: string;
    url: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
  };
  target?: {
    name?: string;
    url?: string;
    verb?: string;
    status?: number;
    durationMs?: number;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
  };
  steps: TraceStep[];
  variables: Record<string, any>;
  fault?: {
    name: string;
    status: number;
    error: string;
  };
}

export class TraceManager {
  private static traces: ExecutionTrace[] = [];
  private static readonly MAX_TRACES = 200;

  /**
   * Tracing is enabled by default.
   * Can be disabled with DISABLE_TRACING=true or BUNGEE_TRACING=false.
   */
  public static isTracingEnabled(): boolean {
    if (process.env.DISABLE_TRACING === "true" || process.env.DISABLE_TRACING === "1") {
      return false;
    }
    if (process.env.BUNGEE_TRACING === "false" || process.env.BUNGEE_TRACING === "0") {
      return false;
    }
    return true;
  }

  public static generateTraceId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  public static generateSpanId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  public static createTrace(
    req: Request | undefined,
    proxyName: string = "proxy"
  ): ExecutionTrace {
    const now = Date.now();
    const headers: Record<string, string> = {};
    let path = "/";
    let url = "http://localhost:8080/";
    let verb = "GET";

    if (req) {
      verb = req.method || "GET";
      url = req.url || url;
      try {
        const parsed = new URL(url);
        path = parsed.pathname;
      } catch {}
      req.headers.forEach((val, key) => {
        headers[key.toLowerCase()] = val;
      });
    }

    return {
      id: this.generateTraceId(),
      spanId: this.generateSpanId(),
      proxyName,
      timestamp: now,
      durationMs: 0,
      clientReceivedTime: now,
      clientSentTime: 0,
      request: {
        verb,
        url,
        path,
        headers,
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
      },
      steps: [],
      variables: {},
    };
  }

  public static recordTrace(trace: ExecutionTrace): void {
    if (!this.isTracingEnabled()) return;
    this.traces.unshift(trace);
    if (this.traces.length > this.MAX_TRACES) {
      this.traces.length = this.MAX_TRACES;
    }
  }

  public static getTraces(): ExecutionTrace[] {
    return this.traces;
  }

  public static getRecentTraces(): any[] {
    return this.traces.map((t) => ({
      id: t.id,
      proxyName: t.proxyName,
      timestamp: t.timestamp,
      durationMs: t.durationMs,
      verb: t.request.verb,
      path: t.request.path,
      status: t.response.status,
      stepCount: t.steps.length,
    }));
  }

  public static getTrace(id: string): ExecutionTrace | undefined {
    return this.traces.find((t) => t.id === id);
  }

  public static getApigeeTrace(id: string): any | undefined {
    const t = this.getTrace(id);
    return t ? this.toApigeeTrace(t) : undefined;
  }

  public static getOtelTrace(id: string): any | undefined {
    const t = this.getTrace(id);
    return t ? this.toOtelTrace(t) : undefined;
  }

  public static clear(): void {
    this.traces = [];
  }

  public static clearTraces(): void {
    this.traces = [];
  }

  /**
   * Converts an execution trace to the Apigee Debug/Trace JSON format.
   */
  public static toApigeeTrace(trace: ExecutionTrace): any {
    const points: any[] = [];

    // 1. ClientReceived
    points.push({
      id: "ClientReceived",
      timestamp: trace.clientReceivedTime,
      results: [
        {
          ActionResult: "RequestMessage",
          headers: Object.entries(trace.request.headers).map(([name, value]) => ({ name, value })),
          verb: trace.request.verb,
          url: trace.request.url,
          content: trace.request.body || "",
        },
      ],
    });

    // 2. Steps
    for (const step of trace.steps) {
      points.push({
        id: "FlowExecution",
        timestamp: step.startTime,
        results: [
          {
            ActionResult: "StepExecution",
            properties: {
              name: step.name,
              type: step.type,
              flow: step.flow,
              status: step.status,
              duration: step.durationMs,
              condition: step.condition || null,
              conditionResult: step.conditionResult ?? true,
              error: step.error || null,
            },
            variableAccessList: step.variablesSnapshot
              ? Object.entries(step.variablesSnapshot).map(([name, value]) => ({
                  name,
                  value: typeof value === "object" ? JSON.stringify(value) : String(value),
                  access: "READ_WRITE",
                }))
              : [],
          },
        ],
      });
    }

    // 3. TargetRequest & TargetResponse (if target call occurred)
    if (trace.target) {
      points.push({
        id: "TargetRequest",
        timestamp: trace.clientReceivedTime + Math.floor(trace.durationMs * 0.3),
        results: [
          {
            ActionResult: "TargetConnection",
            url: trace.target.url || "",
            verb: trace.target.verb || "POST",
            headers: trace.target.requestHeaders
              ? Object.entries(trace.target.requestHeaders).map(([name, value]) => ({ name, value }))
              : [],
          },
        ],
      });

      points.push({
        id: "TargetResponse",
        timestamp: trace.clientReceivedTime + Math.floor(trace.durationMs * 0.8),
        results: [
          {
            ActionResult: "TargetResponse",
            status: trace.target.status || 200,
            duration: trace.target.durationMs || 0,
            headers: trace.target.responseHeaders
              ? Object.entries(trace.target.responseHeaders).map(([name, value]) => ({ name, value }))
              : [],
          },
        ],
      });
    }

    // 4. Fault (if any)
    if (trace.fault) {
      points.push({
        id: "FaultExecution",
        timestamp: trace.clientSentTime || Date.now(),
        results: [
          {
            ActionResult: "FaultRule",
            fault: trace.fault,
          },
        ],
      });
    }

    // 5. ClientSent
    points.push({
      id: "ClientSent",
      timestamp: trace.clientSentTime || Date.now(),
      results: [
        {
          ActionResult: "ResponseMessage",
          status: trace.response.status,
          statusText: trace.response.statusText,
          headers: Object.entries(trace.response.headers).map(([name, value]) => ({ name, value })),
          content: trace.response.body || "",
        },
      ],
    });

    return {
      traceId: trace.id,
      proxyName: trace.proxyName,
      duration: trace.durationMs,
      completed: true,
      point: points,
    };
  }

  /**
   * Converts an execution trace to standard OpenTelemetry (OTEL) ResourceSpans JSON format.
   */
  public static toOtelTrace(trace: ExecutionTrace): any {
    const toNano = (ms: number) => `${BigInt(ms) * 1000000n}`;
    const rootStartNano = toNano(trace.clientReceivedTime);
    const rootEndNano = toNano(trace.clientSentTime || trace.clientReceivedTime + Math.ceil(trace.durationMs));

    const spans: any[] = [];

    // Root Server Span
    spans.push({
      traceId: trace.id,
      spanId: trace.spanId,
      name: `${trace.request.verb} ${trace.request.path}`,
      kind: 2, // SPAN_KIND_SERVER
      startTimeUnixNano: rootStartNano,
      endTimeUnixNano: rootEndNano,
      attributes: [
        { key: "http.method", value: { stringValue: trace.request.verb } },
        { key: "http.target", value: { stringValue: trace.request.path } },
        { key: "http.url", value: { stringValue: trace.request.url } },
        { key: "http.status_code", value: { intValue: trace.response.status } },
        { key: "apigee.proxy", value: { stringValue: trace.proxyName } },
        { key: "apigee.duration_ms", value: { doubleValue: trace.durationMs } },
      ],
      status: {
        code: trace.response.status < 400 ? 1 : 2, // 1: OK, 2: ERROR
        message: trace.fault ? trace.fault.error : trace.response.statusText,
      },
    });

    // Step Spans (Child spans)
    for (const step of trace.steps) {
      const stepSpanId = this.generateSpanId();
      const stepStartNano = toNano(step.startTime);
      const stepEndNano = toNano(step.endTime || step.startTime + Math.ceil(step.durationMs));

      spans.push({
        traceId: trace.id,
        spanId: stepSpanId,
        parentSpanId: trace.spanId,
        name: `Step: ${step.name}`,
        kind: 1, // SPAN_KIND_INTERNAL
        startTimeUnixNano: stepStartNano,
        endTimeUnixNano: stepEndNano,
        attributes: [
          { key: "apigee.policy.name", value: { stringValue: step.name } },
          { key: "apigee.policy.type", value: { stringValue: step.type } },
          { key: "apigee.flow", value: { stringValue: step.flow } },
          { key: "apigee.step.status", value: { stringValue: step.status } },
          { key: "apigee.step.duration_ms", value: { doubleValue: step.durationMs } },
          ...(step.condition ? [{ key: "apigee.step.condition", value: { stringValue: step.condition } }] : []),
          ...(step.error ? [{ key: "error.message", value: { stringValue: step.error } }] : []),
        ],
        status: {
          code: step.status === "FAULT" ? 2 : 1,
          message: step.error || "",
        },
      });
    }

    // Target Span (if target was called)
    if (trace.target && trace.target.url) {
      const targetSpanId = this.generateSpanId();
      const targetStartNano = toNano(trace.clientReceivedTime + Math.floor(trace.durationMs * 0.3));
      const targetEndNano = toNano(trace.clientReceivedTime + Math.floor(trace.durationMs * 0.8));

      spans.push({
        traceId: trace.id,
        spanId: targetSpanId,
        parentSpanId: trace.spanId,
        name: `Target: ${trace.target.name || "HTTP Target"}`,
        kind: 3, // SPAN_KIND_CLIENT
        startTimeUnixNano: targetStartNano,
        endTimeUnixNano: targetEndNano,
        attributes: [
          { key: "http.url", value: { stringValue: trace.target.url } },
          { key: "http.method", value: { stringValue: trace.target.verb || "POST" } },
          { key: "http.status_code", value: { intValue: trace.target.status || 200 } },
          { key: "apigee.target.duration_ms", value: { doubleValue: trace.target.durationMs || 0 } },
        ],
        status: {
          code: (trace.target.status || 200) < 400 ? 1 : 2,
        },
      });
    }

    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "bungee-runtime" } },
              { key: "service.version", value: { stringValue: "1.0.0" } },
              { key: "apigee.proxy", value: { stringValue: trace.proxyName } },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: "bungee.tracer",
                version: "1.0.0",
              },
              spans,
            },
          ],
        },
      ],
    };
  }
}
