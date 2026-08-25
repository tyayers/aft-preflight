import {
  serviceCallout,
  assignMessage,
  keyValueMapOperations,
  verifyApiKey,
  dataCapture,
  raiseFault,
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
  globalKvmStore,
} from "./policies";

export {
  serviceCallout,
  assignMessage,
  keyValueMapOperations,
  verifyApiKey,
  dataCapture,
  raiseFault,
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
  globalKvmStore,
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
        this.path = "";
      }
      for (const [k, v] of req.headers.entries()) {
        this.headers[k.toLowerCase()] = v;
      }
    }
  }

  get content(): any {
    const raw = this._content;
    if (
      raw instanceof ArrayBuffer ||
      ArrayBuffer.isView(raw) ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(raw))
    ) {
      return raw;
    }
    const strObj = new String(raw);
    Object.defineProperty(strObj, "asJSON", {
      get: () => {
        try {
          return JSON.parse(raw);
        } catch {
          return {};
        }
      },
      configurable: true,
      enumerable: false,
    });
    return strObj;
  }

  set content(val: any) {
    if (val === null || val === undefined) {
      this._content = "";
    } else if (
      val instanceof ArrayBuffer ||
      ArrayBuffer.isView(val) ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(val))
    ) {
      this._content = val;
    } else if (typeof val === "object" && !(val instanceof String)) {
      this._content = JSON.stringify(val);
    } else {
      this._content = String(val);
    }
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
    this.content = content;
  }

  get content(): any {
    const raw = this._content;
    if (
      raw instanceof ArrayBuffer ||
      ArrayBuffer.isView(raw) ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(raw))
    ) {
      return raw;
    }
    const strObj = new String(raw);
    Object.defineProperty(strObj, "asJSON", {
      get: () => {
        try {
          return JSON.parse(raw);
        } catch {
          return {};
        }
      },
      configurable: true,
      enumerable: false,
    });
    return strObj;
  }

  set content(val: any) {
    if (val === null || val === undefined) {
      this._content = "";
    } else if (
      val instanceof ArrayBuffer ||
      ArrayBuffer.isView(val) ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(val))
    ) {
      this._content = val;
    } else if (typeof val === "object" && !(val instanceof String)) {
      this._content = JSON.stringify(val);
    } else {
      this._content = String(val);
    }
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
    if (req) {
      try {
        const urlObj = new URL(req.url);
        this.variables["proxy.pathsuffix"] = urlObj.pathname;
        this.variables["proxy.url"] = req.url;
        this.variables["request.verb"] = req.method;
        this.variables["request.path"] = urlObj.pathname;
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
    if (name === "response.status.code" || name === "response.status") {
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
      return this.request.getHeader(headerName);
    }
    if (name.startsWith("request.queryparam.")) {
      const paramName = name.slice("request.queryparam.".length);
      return this.request.getQueryParam(paramName);
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
    if (name === "response.status.code" || name === "response.status") {
      this.response.status = Number(value);
      this.variables[name] = Number(value);
      return;
    }
    if (name.startsWith("response.header.")) {
      const headerName = name.slice("response.header.".length);
      this.response.setHeader(headerName, String(value));
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
      this.request.setHeader(headerName, String(value));
      this.variables[name] = value;
      return;
    }
    if (name.startsWith("request.queryparam.")) {
      const paramName = name.slice("request.queryparam.".length);
      this.request.setQueryParam(paramName, String(value));
      this.variables[name] = value;
      return;
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
}
