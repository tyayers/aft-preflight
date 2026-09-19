/**
 * AFT TESTPILOT - Lightweight Runtime Profiling & Tracing Engine
 *
 * Tracks execution steps, timings, variables, and target calls for every proxy invocation.
 * Supports exporting traces in Apigee Trace/Debug format (matching cloud export format)
 * and OpenTelemetry (OTEL) JSON format for OTEL viewer tools.
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
  proxyDurationMs?: number;
  targetDurationMs?: number;
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

interface ApigeeResultItem {
  actionResult: "DebugInfo" | "RequestMessage" | "ResponseMessage" | "VariableAccess";
  ActionResult: "DebugInfo" | "RequestMessage" | "ResponseMessage" | "VariableAccess";
  accessList: any[];
  timestamp: string;
  properties: {
    properties?: Array<{ name: string; value: string }>;
    property?: Array<{ name: string; value: string }>;
  };
  headers: Array<{ name: string; value: string }>;
  reasonPhrase: string;
  statusCode: string;
  uri: string;
  uRI: string;
  verb: string;
  content: string;
}

function formatApigeeTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number, w: number = 2) => String(n).padStart(w, "0");
  const day = pad(d.getUTCDate());
  const month = pad(d.getUTCMonth() + 1);
  const year = pad(d.getUTCFullYear() % 100);
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());
  const millis = pad(d.getUTCMilliseconds(), 3);
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}:${millis}`;
}

function createDebugInfoResult(timestamp: string, props: Array<{ name: string; value: string }>): ApigeeResultItem {
  return {
    actionResult: "DebugInfo",
    ActionResult: "DebugInfo",
    accessList: [],
    timestamp,
    properties: {
      properties: props,
      property: props,
    },
    headers: [],
    reasonPhrase: "",
    statusCode: "",
    uri: "",
    uRI: "",
    verb: "",
    content: "",
  };
}

function createRequestMessageResult(
  headers: Record<string, string>,
  uri: string,
  verb: string,
  content: string = ""
): ApigeeResultItem {
  const headerList = Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  return {
    actionResult: "RequestMessage",
    ActionResult: "RequestMessage",
    accessList: [],
    timestamp: "",
    properties: {},
    headers: headerList,
    reasonPhrase: "",
    statusCode: "",
    uri,
    uRI: uri,
    verb,
    content,
  };
}

function createResponseMessageResult(
  headers: Record<string, string>,
  statusCode: number,
  reasonPhrase: string = "OK",
  content: string = ""
): ApigeeResultItem {
  const headerList = Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  return {
    actionResult: "ResponseMessage",
    ActionResult: "ResponseMessage",
    accessList: [],
    timestamp: "",
    properties: {},
    headers: headerList,
    reasonPhrase,
    statusCode: String(statusCode),
    uri: "",
    uRI: "",
    verb: "",
    content,
  };
}

function createVariableAccessResult(variables: Record<string, any>): ApigeeResultItem {
  const accessList: any[] = [];
  for (const [name, value] of Object.entries(variables)) {
    if (value === undefined) continue;
    let valStr = "";
    if (typeof value === "object" && value !== null) {
      try {
        valStr = JSON.stringify(value);
      } catch {
        valStr = String(value);
      }
    } else {
      valStr = String(value ?? "");
    }
    accessList.push({
      get: null,
      set: {
        name,
        value: valStr,
        success: true,
      },
      remove: null,
    });
  }
  return {
    actionResult: "VariableAccess",
    ActionResult: "VariableAccess",
    accessList,
    timestamp: "",
    properties: {},
    headers: [],
    reasonPhrase: "",
    statusCode: "",
    uri: "",
    uRI: "",
    verb: "",
    content: "",
  };
}

export class TraceManager {
  private static traces: ExecutionTrace[] = [];
  private static readonly MAX_TRACES = 200;
  private static enabled: boolean = true;

  /**
   * Tracing is enabled by default.
   * Can be disabled via environment variables or programmatically.
   */
  public static isTracingEnabled(): boolean {
    if (process.env.DISABLE_TRACING === "true" || process.env.DISABLE_TRACING === "1") {
      return false;
    }
    if (process.env.BUNGEE_TRACING === "false" || process.env.BUNGEE_TRACING === "0") {
      return false;
    }
    if (process.env.TRACING_ENABLED === "false" || process.env.TRACING_ENABLED === "0") {
      return false;
    }
    if (process.env.ENABLE_TRACING === "false" || process.env.ENABLE_TRACING === "0") {
      return false;
    }
    return this.enabled;
  }

  public static setTracingEnabled(val: boolean): void {
    this.enabled = val;
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
    return this.traces.map((t) => {
      const targetDuration = t.target?.durationMs || 0;
      const proxyDuration = Math.max(0, Math.round((t.durationMs - targetDuration) * 10) / 10);
      return {
        id: t.id,
        proxyName: t.proxyName,
        timestamp: t.timestamp,
        durationMs: t.durationMs,
        proxyDurationMs: proxyDuration,
        targetDurationMs: targetDuration,
        verb: t.request.verb,
        path: t.request.path,
        status: t.response.status,
        stepCount: t.steps.length,
      };
    });
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
   * Converts an execution trace to the official Apigee Trace / Debug JSON format,
   * fully structured with DebugSession and Messages matching Cloud Apigee trace exports.
   */
  public static toApigeeTrace(trace: ExecutionTrace): any {
    const points: any[] = [];
    const baseTime = trace.clientReceivedTime;
    const reqTimestamp = formatApigeeTimestamp(baseTime);

    // 1. Initial StateChange: REQ_START -> REQ_HEADERS_PARSED
    points.push({
      id: "StateChange",
      results: [
        createDebugInfoResult(reqTimestamp, [
          { name: "From", value: "REQ_START" },
          { name: "To", value: "REQ_HEADERS_PARSED" },
        ]),
        createRequestMessageResult(
          trace.request.headers,
          trace.request.path,
          trace.request.verb,
          trace.request.body || ""
        ),
      ],
    });

    // 2. FlowInfo: Environment & Organization info
    const orgName = trace.variables["organization.name"] || process.env.GOOGLE_CLOUD_PROJECT || "local-org";
    const envName = trace.variables["environment.name"] || process.env.APIGEE_ENV || "default-dev";
    points.push({
      id: "FlowInfo",
      results: [
        createDebugInfoResult(reqTimestamp, [
          { name: "environment.orgname", value: orgName },
          { name: "environment.name", value: envName },
          { name: "environment.qualifiedname", value: `${orgName}__${envName}` },
        ]),
      ],
    });

    points.push({
      id: "FlowInfo",
      results: [
        createDebugInfoResult(reqTimestamp, [
          { name: "organization.name", value: orgName },
        ]),
      ],
    });

    // 3. FlowInfo: ApiProxy & ProxyEndpoint context
    points.push({
      id: "FlowInfo",
      results: [
        createDebugInfoResult(reqTimestamp, [
          { name: "apiproxy.qualifiedname", value: `${trace.proxyName}__1` },
          { name: "apiproxy.revision", value: trace.variables["apiproxy.revision"] || "1" },
          { name: "apiproxy.basepath", value: trace.variables["proxy.basepath"] || "/" },
          { name: "apiproxy.name", value: trace.proxyName },
        ]),
      ],
    });

    points.push({
      id: "FlowInfo",
      results: [
        createDebugInfoResult(reqTimestamp, [
          { name: "proxy.url", value: trace.request.url },
          { name: "proxy.name", value: "default" },
          { name: "proxy.basepath", value: trace.variables["proxy.basepath"] || trace.request.path },
          { name: "proxy.pathsuffix", value: trace.variables["proxy.pathsuffix"] || "" },
        ]),
      ],
    });

    // 4. StateChange: REQ_HEADERS_PARSED -> PROXY_REQ_FLOW
    points.push({
      id: "StateChange",
      results: [
        createDebugInfoResult(reqTimestamp, [
          { name: "From", value: "REQ_HEADERS_PARSED" },
          { name: "To", value: "PROXY_REQ_FLOW" },
        ]),
        createRequestMessageResult(
          trace.request.headers,
          trace.request.path,
          trace.request.verb,
          trace.request.body || ""
        ),
      ],
    });

    // Separate steps into request flow vs response flow
    const requestSteps: TraceStep[] = [];
    const responseSteps: TraceStep[] = [];
    for (const step of trace.steps) {
      const flowLower = (step.flow || "").toLowerCase();
      if (flowLower.includes("response") || flowLower.includes("postflow response")) {
        responseSteps.push(step);
      } else {
        requestSteps.push(step);
      }
    }

    // 5. Request Steps Execution
    for (const step of requestSteps) {
      const stepTimestamp = formatApigeeTimestamp(step.startTime);

      if (step.condition) {
        points.push({
          id: "Condition",
          results: [
            createDebugInfoResult(stepTimestamp, [
              { name: "Expression", value: step.condition },
              { name: "ExpressionResult", value: String(step.conditionResult ?? (step.status !== "SKIPPED")) },
              { name: "Tree", value: step.name },
            ]),
            createVariableAccessResult(step.variablesSnapshot || {}),
          ],
        });
      }

      if (step.status !== "SKIPPED") {
        points.push({
          id: "Execution",
          results: [
            createDebugInfoResult(stepTimestamp, [
              { name: "stepDefinition-displayName", value: step.name },
              { name: "internal", value: "false" },
              { name: "stepDefinition-type", value: step.type.toLowerCase() },
              { name: "enforcement", value: "request" },
              { name: "type", value: `${step.type}Execution` },
              { name: "result", value: step.status === "FAULT" ? "false" : "true" },
              { name: "stepDefinition-enabled", "value": "true" },
              { name: "stepDefinition-name", value: step.name },
              { name: "stepExecution-executionTime", value: String(Math.round(step.durationMs)) },
              { name: "action", value: step.status === "FAULT" ? "ABORT" : "CONTINUE" },
              { name: "stepDefinition-continueOnError", value: "false" },
              { name: "stepDefinition-async", value: "false" },
            ]),
            createRequestMessageResult(
              trace.request.headers,
              trace.request.path,
              trace.request.verb,
              trace.request.body || ""
            ),
            createVariableAccessResult(step.variablesSnapshot || {}),
          ],
        });
      }
    }

    // 6. Target call (if target was involved)
    if (trace.target && trace.target.url) {
      const targetTime = trace.clientReceivedTime + Math.floor(trace.durationMs * 0.3);
      const targetTimestamp = formatApigeeTimestamp(targetTime);

      points.push({
        id: "FlowInfo",
        results: [
          createDebugInfoResult(targetTimestamp, [
            { name: "route.name", value: "default" },
            { name: "route.type", value: "TargetEndpoint" },
            { name: "route.target", value: trace.target.name || "default" },
            { name: "target.url", value: trace.target.url || "" },
            { name: "target.name", value: trace.target.name || "default" },
          ]),
        ],
      });

      points.push({
        id: "StateChange",
        results: [
          createDebugInfoResult(targetTimestamp, [
            { name: "From", value: "PROXY_REQ_FLOW" },
            { name: "To", value: "TARGET_REQ_FLOW" },
          ]),
          createRequestMessageResult(
            trace.target.requestHeaders || trace.request.headers,
            trace.target.url || trace.request.path,
            trace.target.verb || "POST",
            ""
          ),
        ],
      });

      points.push({ id: "Paused", results: [] });
      points.push({ id: "Resumed", results: [] });

      const respTimestamp = formatApigeeTimestamp(targetTime + Math.ceil(trace.target.durationMs || 0));
      points.push({
        id: "StateChange",
        results: [
          createDebugInfoResult(respTimestamp, [
            { name: "From", value: "TARGET_REQ_FLOW" },
            { name: "To", value: "REQ_SENT" },
          ]),
          createResponseMessageResult(
            trace.target.responseHeaders || {},
            trace.target.status || 200,
            "OK",
            ""
          ),
        ],
      });

      points.push({
        id: "StateChange",
        results: [
          createDebugInfoResult(respTimestamp, [
            { name: "From", value: "REQ_SENT" },
            { name: "To", value: "RESP_START" },
          ]),
          createResponseMessageResult(
            trace.target.responseHeaders || {},
            trace.target.status || 200,
            "OK",
            ""
          ),
        ],
      });

      points.push({
        id: "StateChange",
        results: [
          createDebugInfoResult(respTimestamp, [
            { name: "From", value: "RESP_START" },
            { name: "To", value: "TARGET_RESP_FLOW" },
          ]),
          createResponseMessageResult(
            trace.target.responseHeaders || {},
            trace.target.status || 200,
            "OK",
            ""
          ),
        ],
      });

      points.push({
        id: "StateChange",
        results: [
          createDebugInfoResult(respTimestamp, [
            { name: "From", value: "TARGET_RESP_FLOW" },
            { name: "To", value: "PROXY_RESP_FLOW" },
          ]),
          createResponseMessageResult(
            trace.response.headers,
            trace.response.status,
            trace.response.statusText,
            trace.response.body || ""
          ),
        ],
      });
    } else {
      // Direct proxy response (no target)
      points.push({
        id: "StateChange",
        results: [
          createDebugInfoResult(reqTimestamp, [
            { name: "From", value: "PROXY_REQ_FLOW" },
            { name: "To", value: "PROXY_RESP_FLOW" },
          ]),
          createResponseMessageResult(
            trace.response.headers,
            trace.response.status,
            trace.response.statusText,
            trace.response.body || ""
          ),
        ],
      });
    }

    // 7. Response Steps Execution
    for (const step of responseSteps) {
      const stepTimestamp = formatApigeeTimestamp(step.startTime);

      if (step.condition) {
        points.push({
          id: "Condition",
          results: [
            createDebugInfoResult(stepTimestamp, [
              { name: "Expression", value: step.condition },
              { name: "ExpressionResult", value: String(step.conditionResult ?? (step.status !== "SKIPPED")) },
              { name: "Tree", value: step.name },
            ]),
            createVariableAccessResult(step.variablesSnapshot || {}),
          ],
        });
      }

      if (step.status !== "SKIPPED") {
        points.push({
          id: "Execution",
          results: [
            createDebugInfoResult(stepTimestamp, [
              { name: "stepDefinition-displayName", value: step.name },
              { name: "internal", value: "false" },
              { name: "stepDefinition-type", value: step.type.toLowerCase() },
              { name: "enforcement", value: "response" },
              { name: "type", value: `${step.type}Execution` },
              { name: "result", value: step.status === "FAULT" ? "false" : "true" },
              { name: "stepDefinition-enabled", "value": "true" },
              { name: "stepDefinition-name", value: step.name },
              { name: "stepExecution-executionTime", value: String(Math.round(step.durationMs)) },
              { name: "action", value: step.status === "FAULT" ? "ABORT" : "CONTINUE" },
              { name: "stepDefinition-continueOnError", value: "false" },
              { name: "stepDefinition-async", value: "false" },
            ]),
            createResponseMessageResult(
              trace.response.headers,
              trace.response.status,
              trace.response.statusText,
              trace.response.body || ""
            ),
            createVariableAccessResult(step.variablesSnapshot || {}),
          ],
        });
      }
    }

    // 8. Final StateChanges: PROXY_RESP_FLOW -> RESP_SENT -> END
    const endTimestamp = formatApigeeTimestamp(trace.clientSentTime || baseTime + Math.ceil(trace.durationMs));
    points.push({
      id: "StateChange",
      results: [
        createDebugInfoResult(endTimestamp, [
          { name: "From", value: "PROXY_RESP_FLOW" },
          { name: "To", value: "RESP_SENT" },
        ]),
        createResponseMessageResult(
          trace.response.headers,
          trace.response.status,
          trace.response.statusText,
          trace.response.body || ""
        ),
        createVariableAccessResult(trace.variables || {}),
      ],
    });

    points.push({
      id: "StateChange",
      results: [
        createDebugInfoResult(endTimestamp, [
          { name: "From", value: "RESP_SENT" },
          { name: "To", value: "END" },
        ]),
        createResponseMessageResult(
          trace.response.headers,
          trace.response.status,
          trace.response.statusText,
          trace.response.body || ""
        ),
      ],
    });

    const result: any = {
      DebugSession: {
        Retrieved: new Date().toISOString(),
        Recorded: new Date(trace.timestamp).toISOString(),
        Organization: orgName,
        Environment: envName,
        API: trace.proxyName,
        Revision: trace.variables["apiproxy.revision"] || "1",
        SessionId: trace.id,
        Version: "2.1",
      },
      Messages: [
        {
          completed: true,
          point: points,
        },
      ],
    };

    // Non-enumerable properties for backward compatibility
    Object.defineProperty(result, "point", {
      get() {
        return points;
      },
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(result, "traceId", {
      get() {
        return trace.id;
      },
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(result, "proxyName", {
      get() {
        return trace.proxyName;
      },
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(result, "duration", {
      get() {
        return trace.durationMs;
      },
      enumerable: false,
      configurable: true,
    });

    return result;
  }

  /**
   * Converts an execution trace to standard OpenTelemetry (OTEL) ResourceSpans JSON format
   * readable by standard OTEL viewer applications and collectors.
   */
  public static toOtelTrace(trace: ExecutionTrace): any {
    const toNano = (ms: number) => `${BigInt(Math.floor(ms)) * 1000000n}`;
    const rootStartNano = toNano(trace.clientReceivedTime);
    const rootEndNano = toNano(trace.clientSentTime || trace.clientReceivedTime + Math.ceil(trace.durationMs));

    const spans: any[] = [];
    const targetDuration = trace.target?.durationMs || 0;
    const proxyDuration = Math.max(0, Math.round((trace.durationMs - targetDuration) * 10) / 10);

    // Root Server Span
    spans.push({
      traceId: trace.id,
      spanId: trace.spanId,
      parentSpanId: "",
      name: `${trace.request.verb} ${trace.request.path}`,
      kind: 2, // SPAN_KIND_SERVER
      startTimeUnixNano: rootStartNano,
      endTimeUnixNano: rootEndNano,
      attributes: [
        { key: "http.method", value: { stringValue: trace.request.verb } },
        { key: "http.request.method", value: { stringValue: trace.request.verb } },
        { key: "http.target", value: { stringValue: trace.request.path } },
        { key: "http.route", value: { stringValue: trace.request.path } },
        { key: "url.path", value: { stringValue: trace.request.path } },
        { key: "url.full", value: { stringValue: trace.request.url } },
        { key: "http.status_code", value: { intValue: String(trace.response.status) } },
        { key: "http.response.status_code", value: { intValue: String(trace.response.status) } },
        { key: "apigee.proxy", value: { stringValue: trace.proxyName } },
        { key: "apigee.duration_ms", value: { doubleValue: trace.durationMs } },
        { key: "apigee.proxy_duration_ms", value: { doubleValue: proxyDuration } },
        { key: "apigee.target_duration_ms", value: { doubleValue: targetDuration } },
        ...(trace.request.body ? [{ key: "http.request.body", value: { stringValue: trace.request.body } }] : []),
        ...(trace.response.body ? [{ key: "http.response.body", value: { stringValue: trace.response.body } }] : []),
      ],
      status: {
        code: trace.response.status < 400 ? 1 : 2, // 1: OK, 2: ERROR
        message: trace.fault ? trace.fault.error : (trace.response.status >= 400 ? trace.response.statusText : ""),
      },
    });

    // Step Spans (Child spans)
    for (const step of trace.steps) {
      const stepSpanId = step.id || this.generateSpanId();
      const stepStartNano = toNano(step.startTime);
      const stepEndNano = toNano(step.endTime || step.startTime + Math.ceil(step.durationMs));

      const stepAttributes: any[] = [
        { key: "apigee.policy.name", value: { stringValue: step.name } },
        { key: "apigee.policy.type", value: { stringValue: step.type } },
        { key: "apigee.flow", value: { stringValue: step.flow } },
        { key: "apigee.step.status", value: { stringValue: step.status } },
        { key: "apigee.step.duration_ms", value: { doubleValue: step.durationMs } },
      ];

      if (step.condition) {
        stepAttributes.push({ key: "apigee.step.condition", value: { stringValue: step.condition } });
        stepAttributes.push({
          key: "apigee.step.condition_result",
          value: { stringValue: String(step.conditionResult ?? (step.status !== "SKIPPED")) },
        });
      }

      if (step.error) {
        stepAttributes.push({ key: "error.message", value: { stringValue: step.error } });
      }

      // Save all variable values in this trace step
      if (step.variablesSnapshot) {
        for (const [varName, varVal] of Object.entries(step.variablesSnapshot)) {
          if (varVal === undefined) continue;
          let strVal = "";
          if (typeof varVal === "object" && varVal !== null) {
            try {
              strVal = JSON.stringify(varVal);
            } catch {
              strVal = String(varVal);
            }
          } else {
            strVal = String(varVal ?? "");
          }
          stepAttributes.push({
            key: `apigee.variable.${varName}`,
            value: { stringValue: strVal },
          });
        }
      }

      spans.push({
        traceId: trace.id,
        spanId: stepSpanId,
        parentSpanId: trace.spanId,
        name: `Step: ${step.name}`,
        kind: 1, // SPAN_KIND_INTERNAL
        startTimeUnixNano: stepStartNano,
        endTimeUnixNano: stepEndNano,
        attributes: stepAttributes,
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
      const targetEndNano = toNano(
        trace.clientReceivedTime + Math.floor(trace.durationMs * 0.3) + Math.ceil(targetDuration)
      );

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
          { key: "http.status_code", value: { intValue: String(trace.target.status || 200) } },
          { key: "http.response.status_code", value: { intValue: String(trace.target.status || 200) } },
          { key: "apigee.target.name", value: { stringValue: trace.target.name || "default" } },
          { key: "apigee.target.duration_ms", value: { doubleValue: targetDuration } },
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
              { key: "service.name", value: { stringValue: "aft-testpilot" } },
              { key: "service.version", value: { stringValue: "1.0.0" } },
              { key: "apigee.proxy", value: { stringValue: trace.proxyName } },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: "aft-testpilot.tracer",
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
