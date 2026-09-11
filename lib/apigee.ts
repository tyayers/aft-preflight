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

  constructor(req?: Request, initialVariables: Record<string, any> = {}) {
    this.request = new ApigeeRequest(req);
    this.response = new ApigeeResponse();
    this.variables = { ...initialVariables };

    // Standard Apigee variables initialization
    this.variables["organization.name"] = process.env.APIGEE_ORG || "bungee-org";
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
