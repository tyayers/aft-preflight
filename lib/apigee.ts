import {
  serviceCallout,
  assignMessage,
  keyValueMapOperations,
  verifyApiKey,
  dataCapture,
  raiseFault,
  oasValidation,
  type ServiceCalloutOptions,
  type AssignMessageOptions,
  type AssignVariableConfig,
  type KeyValueMapOptions,
  type KeyValueMapGet,
  type KeyValueMapPut,
  type KeyValueStore,
  type VerifyApiKeyOptions,
  type DataCaptureOptions,
  type DataCaptureCollector,
  type RaiseFaultOptions,
  type OASValidationOptions,
  globalKvmStore,
  globalResourceStore,
  capturedDataMetrics,
} from "./policies";
import { evaluateCondition } from "./condition";
import { getCachedProjectId } from "./googleAuth";
import { TraceManager, type ExecutionTrace, type TraceStep } from "./tracer";

// Extend String prototype to support Apigee's .asJSON accessor on JSON strings
declare global {
  interface String {
    asJSON?: any;
  }
}

if (!Object.prototype.hasOwnProperty.call(String.prototype, "asJSON")) {
  Object.defineProperty(String.prototype, "asJSON", {
    get() {
      try {
        return JSON.parse(this.toString());
      } catch {
        return null;
      }
    },
    configurable: true,
  });
}

export {
  serviceCallout,
  assignMessage,
  keyValueMapOperations,
  verifyApiKey,
  dataCapture,
  raiseFault,
  oasValidation,
  evaluateCondition,
  type ServiceCalloutOptions,
  type AssignMessageOptions,
  type AssignVariableConfig,
  type KeyValueMapOptions,
  type KeyValueMapGet,
  type KeyValueMapPut,
  type KeyValueStore,
  type VerifyApiKeyOptions,
  type DataCaptureOptions,
  type DataCaptureCollector,
  type RaiseFaultOptions,
  type OASValidationOptions,
  globalKvmStore,
  globalResourceStore,
  capturedDataMetrics,
  TraceManager,
  type ExecutionTrace,
  type TraceStep,
};

export class ApigeeRequest {
  headers: Record<string, string> = {};
  queryParams: Record<string, string> = {};
  path: string = "";
  method: string = "GET";
  url: string = "";
  private _content: any = "";

  constructor(req?: Request) {
    if (req) {
      this.method = req.method;
      this.url = req.url;
      try {
        const parsedUrl = new URL(req.url);
        this.path = parsedUrl.pathname;
        parsedUrl.searchParams.forEach((val, key) => {
          this.queryParams[key] = val;
        });
      } catch {
        // ignore
      }

      // Populate headers
      req.headers.forEach((val, key) => {
        this.headers[key.toLowerCase()] = val;
      });
    }
  }

  get content(): any {
    if (this._content && typeof this._content === "object" && !(this._content instanceof Uint8Array || this._content instanceof ArrayBuffer)) {
      const obj = this._content;
      return {
        ...obj,
        toString: () => JSON.stringify(obj),
        valueOf: () => JSON.stringify(obj),
        get asJSON() {
          return obj;
        },
      };
    }
    return this._content;
  }

  set content(val: any) {
    this._content = val;
  }

  get rawContent(): any {
    return this._content;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  removeHeader(name: string): void {
    delete this.headers[name.toLowerCase()];
  }

  getQueryParam(name: string): string | undefined {
    return this.queryParams[name];
  }

  setQueryParam(name: string, value: string): void {
    this.queryParams[name] = value;
  }

  removeQueryParam(name: string): void {
    delete this.queryParams[name];
  }
}

export class ApigeeResponse {
  status: number = 200;
  statusText: string = "OK";
  headers: Record<string, string> = {};
  private _content: any = "";

  constructor(status: number = 200, headers: Record<string, string> = {}, content: any = "") {
    this.status = status;
    this.headers = {};
    for (const [k, v] of Object.entries(headers)) {
      this.headers[k.toLowerCase()] = v;
    }
    this._content = content;
  }

  get content(): any {
    if (this._content && typeof this._content === "object" && !(this._content instanceof Uint8Array || this._content instanceof ArrayBuffer)) {
      const obj = this._content;
      return {
        ...obj,
        toString: () => JSON.stringify(obj),
        valueOf: () => JSON.stringify(obj),
        get asJSON() {
          return obj;
        },
      };
    }
    return this._content;
  }

  set content(val: any) {
    this._content = val;
  }

  get rawContent(): any {
    return this._content;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  removeHeader(name: string): void {
    delete this.headers[name.toLowerCase()];
  }
}

export class ApigeeContext {
  variables: Record<string, any> = {};
  request: ApigeeRequest;
  response: ApigeeResponse;
  fault: any = null;
  proxyName: string = "proxy";
  trace: ExecutionTrace | null = null;

  constructor(req?: Request, initialVariables: Record<string, any> = {}, proxyName: string = "proxy") {
    this.proxyName = proxyName;
    this.request = new ApigeeRequest(req);
    this.response = new ApigeeResponse();
    this.variables = { ...initialVariables };

    // Standard Apigee variables initialization
    this.variables["organization.name"] = getCachedProjectId();
    this.variables["environment.name"] = process.env.APIGEE_ENV || "local";
    this.variables["client.received.start.timestamp"] = Date.now();
    this.variables["system.timestamp"] = Date.now();

    if (req) {
      try {
        const urlObj = new URL(req.url);
        this.variables["proxy.pathsuffix"] = urlObj.pathname;
        this.variables["proxy.url"] = req.url;
        this.variables["request.verb"] = req.method;
        this.variables["request.path"] = urlObj.pathname;
        this.variables["request.header.host"] = urlObj.host;
      } catch {
        // ignore
      }
    }

    if (TraceManager.isTracingEnabled()) {
      this.trace = TraceManager.createTrace(req, this.proxyName);
    }
  }

  public setProxyName(name: string): void {
    this.proxyName = name;
    if (this.trace) {
      this.trace.proxyName = name;
    }
  }

  public async traceStep(
    name: string,
    type: string,
    flow: string,
    fn: () => Promise<void>
  ): Promise<void> {
    if (!this.trace) {
      return await fn();
    }

    const startTime = Date.now();
    const stepId = TraceManager.generateSpanId();
    try {
      await fn();
      const endTime = Date.now();
      const durationMs = Math.max(0.05, endTime - startTime);
      this.trace.steps.push({
        id: stepId,
        name,
        type,
        flow,
        startTime,
        endTime,
        durationMs,
        status: "SUCCESS",
        variablesSnapshot: this.getTraceVariablesSnapshot(),
      });
    } catch (err: any) {
      const endTime = Date.now();
      const durationMs = Math.max(0.05, endTime - startTime);
      this.trace.steps.push({
        id: stepId,
        name,
        type,
        flow,
        startTime,
        endTime,
        durationMs,
        status: "FAULT",
        error: err?.message || String(err),
        variablesSnapshot: this.getTraceVariablesSnapshot(),
      });
      throw err;
    }
  }

  public recordSkippedStep(
    name: string,
    type: string,
    flow: string,
    condition?: string
  ): void {
    if (!this.trace) return;
    const now = Date.now();
    this.trace.steps.push({
      id: TraceManager.generateSpanId(),
      name,
      type,
      flow,
      condition,
      conditionResult: false,
      startTime: now,
      endTime: now,
      durationMs: 0,
      status: "SKIPPED",
      variablesSnapshot: this.getTraceVariablesSnapshot(),
    });
  }

  public recordTargetCall(targetInfo: {
    name?: string;
    url?: string;
    verb?: string;
    status?: number;
    durationMs?: number;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
  }): void {
    if (!this.trace) return;
    this.trace.target = { ...targetInfo };
  }

  private _streamedChunks: string[] = [];

  public appendStreamChunk(chunk: any): void {
    if (chunk === undefined || chunk === null) return;
    const str =
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(chunk))
        ? new TextDecoder().decode(chunk)
        : String(chunk);
    this._streamedChunks.push(str);
    if (this.trace) {
      if (!this.trace.response.body) {
        this.trace.response.body = str;
      } else if (this.trace.response.body.length < 500000) {
        this.trace.response.body += str;
      }
    }
  }

  public finalizeStreamTrace(): void {
    if (!this.trace) return;
    if (this._streamedChunks.length > 0) {
      const full = this._streamedChunks.join("");
      this.trace.response.body = full.length > 500000 ? full.slice(0, 500000) + "... [truncated]" : full;
    }
    this.trace.clientSentTime = Date.now();
    this.trace.durationMs = Math.max(0.1, this.trace.clientSentTime - this.trace.clientReceivedTime);
    this.trace.proxyDurationMs = Math.max(0, Math.round((this.trace.durationMs - (this.trace.targetDurationMs || 0)) * 10) / 10);
  }

  public finalizeTrace(): ExecutionTrace | null {
    if (!this.trace) return null;
    this.trace.clientSentTime = Date.now();
    this.trace.durationMs = Math.max(0.1, this.trace.clientSentTime - this.trace.clientReceivedTime);
    this.trace.targetDurationMs = this.trace.target?.durationMs || 0;
    this.trace.proxyDurationMs = Math.max(0, Math.round((this.trace.durationMs - this.trace.targetDurationMs) * 10) / 10);
    this.trace.response.status = this.response.status;
    this.trace.response.statusText = this.response.statusText;
    this.trace.response.headers = { ...this.response.headers };

    if (this.request.headers) {
      this.trace.request.headers = { ...this.trace.request.headers, ...this.request.headers };
    }

    const formatPayload = (c: any): string | undefined => {
      if (c === null || c === undefined || c === "") return undefined;
      if (typeof c === "string") {
        return c.length > 500000 ? c.slice(0, 500000) + "... [truncated]" : c;
      }
      if (c instanceof Uint8Array || c instanceof ArrayBuffer) {
        try {
          const decoded = new TextDecoder().decode(c);
          return decoded.length > 500000 ? decoded.slice(0, 500000) + "... [truncated]" : decoded;
        } catch {
          return `[Binary data: ${c.byteLength || (c as any).length} bytes]`;
        }
      }
      try {
        const jsonStr = JSON.stringify(c, null, 2);
        return jsonStr.length > 500000 ? jsonStr.slice(0, 500000) + "... [truncated]" : jsonStr;
      } catch {
        return String(c);
      }
    };

    const respBody = formatPayload(this.response.rawContent ?? this.response.content) ?? formatPayload(this.variables["response.content"]);
    if (respBody !== undefined) {
      this.trace.response.body = respBody;
    } else if (this._streamedChunks.length > 0 && !this.trace.response.body) {
      this.trace.response.body = this._streamedChunks.join("");
    }

    const reqBody = formatPayload(this.request.rawContent ?? this.request.content) ?? formatPayload(this.variables["request.content"]);
    if (reqBody !== undefined) {
      this.trace.request.body = reqBody;
    }

    if (this.fault) {
      this.trace.fault = {
        name: this.fault.name || "Fault",
        status: this.fault.status || (this.response.status !== 200 ? this.response.status : 500),
        error: this.fault.error || String(this.fault),
      };
    }

    this.trace.variables = { ...this.variables };
    TraceManager.recordTrace(this.trace);
    this.response.setHeader("x-bungee-trace-id", this.trace.id);
    return this.trace;
  }

  private getTraceVariablesSnapshot(): Record<string, any> {
    const snapshot: Record<string, any> = {};

    // Standard request/response context
    if (this.request.method) snapshot["request.verb"] = this.request.method;
    if (this.request.path) snapshot["request.path"] = this.request.path;
    if (this.request.url) snapshot["request.url"] = this.request.url;
    if (this.response.status) snapshot["response.status.code"] = this.response.status;

    // Capture ALL variables currently in the context
    for (const [k, v] of Object.entries(this.variables)) {
      if (v === undefined) continue;
      if (v instanceof ArrayBuffer || (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(v))) {
        snapshot[k] = "[binary data]";
      } else if (typeof v === "object" && v !== null) {
        try {
          snapshot[k] = JSON.parse(JSON.stringify(v));
        } catch {
          snapshot[k] = String(v);
        }
      } else {
        snapshot[k] = v;
      }
    }
    return snapshot;
  }

  getVariable(name: string): any {
    if (!name) return undefined;

    // Response variables
    if (name === "response.content") {
      return this.response.content;
    }
    if (name === "response.status.code" || name === "response.status" || name === "message.status.code") {
      return this.response.status;
    }
    if (name.startsWith("response.header.")) {
      const headerName = name.slice("response.header.".length);
      return this.response.getHeader(headerName);
    }

    // Request variables
    if (name === "request.content") {
      return this.request.content;
    }
    if (name === "request.verb" || name === "request.method") {
      return this.request.method;
    }
    if (name.startsWith("request.header.")) {
      const headerName = name.slice("request.header.".length);
      const val = this.request.getHeader(headerName);
      if (val !== undefined) return val;
      return this.variables[name];
    }
    if (name.startsWith("request.queryparam.")) {
      const paramName = name.slice("request.queryparam.".length);
      const val = this.request.getQueryParam(paramName);
      if (val !== undefined) return val;
      return this.variables[name];
    }

    // Fault variables
    if (name === "fault.name") {
      return this.fault?.name || this.variables["fault.name"];
    }

    // Direct match in variables
    if (this.variables[name] !== undefined) {
      return this.variables[name];
    }

    // Case-insensitive fallback
    const lowerName = name.toLowerCase();
    for (const [k, v] of Object.entries(this.variables)) {
      if (k.toLowerCase() === lowerName) {
        return v;
      }
    }

    return undefined;
  }

  setVariable(name: string, value: any): void {
    if (!name) return;

    if (name === "response.content") {
      this.response.content = value;
      this.variables[name] = value;
      return;
    }
    if (name === "response.status.code" || name === "response.status" || name === "message.status.code") {
      this.response.status = Number(value);
      this.variables[name] = Number(value);
      return;
    }
    if (name.startsWith("response.header.")) {
      const headerName = name.slice("response.header.".length);
      if (value === null || value === undefined) {
        this.response.removeHeader(headerName);
      } else {
        this.response.setHeader(headerName, String(value));
      }
      this.variables[name] = value;
      return;
    }

    if (name === "request.content") {
      this.request.content = value;
      this.variables[name] = value;
      return;
    }
    if (name.startsWith("request.header.")) {
      const headerName = name.slice("request.header.".length);
      if (value === null || value === undefined) {
        this.request.removeHeader(headerName);
      } else {
        this.request.setHeader(headerName, String(value));
      }
      this.variables[name] = value;
      return;
    }
    if (name.startsWith("request.queryparam.")) {
      const paramName = name.slice("request.queryparam.".length);
      if (value === null || value === undefined) {
        this.request.removeQueryParam(paramName);
      } else {
        this.request.setQueryParam(paramName, String(value));
      }
      this.variables[name] = value;
      return;
    }

    if (name === "fault.name" && this.fault) {
      this.fault.name = value;
    }

    this.variables[name] = value;
  }

  resolveVariables(template: string, ignoreUnresolved: boolean = true): string {
    if (typeof template !== "string") return String(template ?? "");
    return template.replace(/\{([^{}]+)\}/g, (match, varName) => {
      const val = this.getVariable(varName.trim());
      if (val !== undefined && val !== null) {
        if (ArrayBuffer.isView(val) || val instanceof ArrayBuffer) {
          return "[binary data]";
        }
        return typeof val === "object" ? JSON.stringify(val) : String(val);
      }
      return ignoreUnresolved ? "" : match;
    });
  }
}

export class Apigee {
  static serviceCallout = serviceCallout;
  static assignMessage = assignMessage;
  static keyValueMapOperations = keyValueMapOperations;
  static verifyApiKey = verifyApiKey;
  static dataCapture = dataCapture;
  static raiseFault = raiseFault;
  static oasValidation = oasValidation;
  static evaluateCondition = evaluateCondition;
}
