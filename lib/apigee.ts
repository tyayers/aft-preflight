export interface KeyValueStore {
  [mapIdentifier: string]: Record<string, any>;
}

// Global in-memory KVM store
const globalKvmStore: KeyValueStore = {};

export class ApigeeRequest {
  headers: Record<string, string> = {};
  queryParams: Record<string, string> = {};
  path: string = "";
  method: string = "GET";
  url: string = "";
  private _content: string = "";

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
    } else if (typeof val === "object" && !(val instanceof String)) {
      this._content = JSON.stringify(val);
    } else {
      this._content = String(val);
    }
  }

  get rawContent(): string {
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
  private _content: string = "";

  constructor(status: number = 200, headers: Record<string, string> = {}, content: string = "") {
    this.status = status;
    this.headers = {};
    for (const [k, v] of Object.entries(headers)) {
      this.headers[k.toLowerCase()] = v;
    }
    this.content = content;
  }

  get content(): any {
    const raw = this._content;
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
    } else if (typeof val === "object" && !(val instanceof String)) {
      this._content = JSON.stringify(val);
    } else {
      this._content = String(val);
    }
  }

  get rawContent(): string {
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
        return typeof val === "object" ? JSON.stringify(val) : String(val);
      }
      return ignoreUnresolved ? "" : match;
    });
  }
}

// Policy parameter interfaces
export interface ServiceCalloutOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  payload?: string;
  requestVar?: string;
  responseVar?: string;
  timeout?: number;
  continueOnError?: boolean;
}

export interface AssignVariableConfig {
  name: string;
  value?: any;
  ref?: string;
  template?: string;
}

export interface AssignMessageOptions {
  setHeaders?: Record<string, string>;
  addHeaders?: Record<string, string>;
  removeHeaders?: string[];
  setQueryParams?: Record<string, string>;
  removeQueryParams?: string[];
  setPayload?: { value: string; contentType?: string } | string;
  setStatusCode?: number;
  setReasonPhrase?: string;
  assignVariables?: AssignVariableConfig[];
  assignTo?: "request" | "response" | string;
  ignoreUnresolvedVariables?: boolean;
}

export interface KeyValueMapGet {
  key: string;
  assignTo: string;
}

export interface KeyValueMapPut {
  key: string;
  value?: string;
  ref?: string;
}

export interface KeyValueMapOptions {
  mapIdentifier: string;
  get?: KeyValueMapGet[];
  put?: KeyValueMapPut[];
  delete?: string[];
}

export interface VerifyApiKeyOptions {
  keyRef?: string;
  keyValue?: string;
  policyName?: string;
  continueOnError?: boolean;
}

export interface DataCaptureCollector {
  collectorName: string;
  ref?: string;
  defaultValue?: string;
}

export interface DataCaptureOptions {
  collectors: DataCaptureCollector[];
}

export interface RaiseFaultOptions {
  faultName?: string;
  statusCode?: number;
  reasonPhrase?: string;
  headers?: Record<string, string>;
  payload?: string;
}

export class Apigee {
  /**
   * ServiceCallout Policy implementation
   * Makes HTTP callout and populates context variables
   */
  static async serviceCallout(options: ServiceCalloutOptions, context: ApigeeContext): Promise<void> {
    if (!options || !options.url) return;

    const resolvedUrl = context.resolveVariables(options.url);
    const responseVarName = options.responseVar || "response";

    let calloutMethod = options.method || "GET";
    let calloutHeaders: Record<string, string> = {};
    let calloutBody: any = undefined;

    if (options.requestVar) {
      const storedBody = context.getVariable(`${options.requestVar}.content`);
      if (storedBody) calloutBody = storedBody;
    }

    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        calloutHeaders[k] = context.resolveVariables(v);
      }
    }

    if (options.payload) {
      calloutBody = context.resolveVariables(options.payload);
    }

    try {
      const response = await fetch(resolvedUrl, {
        method: calloutMethod,
        headers: calloutHeaders,
        body: calloutBody,
        tls: { rejectUnauthorized: false } as any,
      });

      const responseText = await response.text();
      const responseHeaders = Object.fromEntries(response.headers.entries());

      // Populate context variables
      context.setVariable(`${responseVarName}.content`, responseText);
      context.setVariable(`${responseVarName}.status.code`, response.status);
      context.setVariable(`${responseVarName}.reason.phrase`, response.statusText);

      for (const [headerKey, headerVal] of Object.entries(responseHeaders)) {
        context.setVariable(`${responseVarName}.header.${headerKey.toLowerCase()}`, headerVal);
      }

      context.setVariable(responseVarName, {
        status: response.status,
        headers: responseHeaders,
        content: responseText,
      });
    } catch (err: any) {
      console.error(`ServiceCallout error for ${resolvedUrl}:`, err.message);
      if (!options.continueOnError) {
        throw err;
      }
    }
  }

  /**
   * AssignMessage Policy implementation
   * Sets, adds, removes headers/queryparams/payload, or sets variables
   */
  static async assignMessage(options: AssignMessageOptions, context: ApigeeContext): Promise<void> {
    if (!options) return;

    const ignoreUnresolved = options.ignoreUnresolvedVariables ?? true;
    const assignTo = (options.assignTo || "response").toLowerCase();

    // 1. Set Headers
    if (options.setHeaders) {
      for (const [name, val] of Object.entries(options.setHeaders)) {
        const resolvedVal = context.resolveVariables(val, ignoreUnresolved);
        if (assignTo === "request") {
          context.request.setHeader(name, resolvedVal);
        } else if (assignTo === "response") {
          context.response.setHeader(name, resolvedVal);
        } else {
          context.setVariable(`${options.assignTo}.header.${name.toLowerCase()}`, resolvedVal);
        }
      }
    }

    // 2. Add Headers
    if (options.addHeaders) {
      for (const [name, val] of Object.entries(options.addHeaders)) {
        const resolvedVal = context.resolveVariables(val, ignoreUnresolved);
        if (assignTo === "request") {
          context.request.setHeader(name, resolvedVal);
        } else {
          context.response.setHeader(name, resolvedVal);
        }
      }
    }

    // 3. Remove Headers
    if (options.removeHeaders) {
      for (const name of options.removeHeaders) {
        if (assignTo === "request") {
          context.request.removeHeader(name);
        } else {
          context.response.removeHeader(name);
        }
      }
    }

    // 4. Set QueryParams
    if (options.setQueryParams) {
      for (const [name, val] of Object.entries(options.setQueryParams)) {
        const resolvedVal = context.resolveVariables(val, ignoreUnresolved);
        context.request.setQueryParam(name, resolvedVal);
      }
    }

    // 5. Remove QueryParams
    if (options.removeQueryParams) {
      for (const name of options.removeQueryParams) {
        delete context.request.queryParams[name];
      }
    }

    // 6. Set Payload
    if (options.setPayload !== undefined) {
      let payloadContent = "";
      let contentType = "";
      if (typeof options.setPayload === "string") {
        payloadContent = options.setPayload;
      } else if (options.setPayload && typeof options.setPayload === "object") {
        payloadContent = options.setPayload.value || "";
        contentType = options.setPayload.contentType || "";
      }
      const resolvedPayload = context.resolveVariables(payloadContent, ignoreUnresolved);
      if (assignTo === "request") {
        context.request.content = resolvedPayload;
        if (contentType) context.request.setHeader("content-type", contentType);
      } else if (assignTo === "response") {
        context.response.content = resolvedPayload;
        if (contentType) context.response.setHeader("content-type", contentType);
      } else {
        context.setVariable(`${options.assignTo}.content`, resolvedPayload);
      }
    }

    // 7. Set StatusCode & ReasonPhrase
    if (options.setStatusCode !== undefined) {
      context.response.status = options.setStatusCode;
    }
    if (options.setReasonPhrase !== undefined) {
      context.response.statusText = options.setReasonPhrase;
    }

    // 8. AssignVariables
    if (options.assignVariables) {
      for (const av of options.assignVariables) {
        if (!av.name) continue;
        let val: any = undefined;
        if (av.ref) {
          val = context.getVariable(av.ref);
        }
        if (val === undefined && av.value !== undefined) {
          val = av.value;
        }
        if (val === undefined && av.template !== undefined) {
          val = context.resolveVariables(av.template, ignoreUnresolved);
        }
        context.setVariable(av.name, val);
      }
    }
  }

  /**
   * KeyValueMapOperations Policy implementation
   */
  static async keyValueMapOperations(options: KeyValueMapOptions, context: ApigeeContext): Promise<void> {
    if (!options) return;

    const mapIdentifier = options.mapIdentifier || "default";
    if (!globalKvmStore[mapIdentifier]) {
      globalKvmStore[mapIdentifier] = {};
    }
    const map = globalKvmStore[mapIdentifier];

    // GET
    if (options.get) {
      for (const item of options.get) {
        if (item.key && item.assignTo) {
          const val = map[item.key] ?? "";
          context.setVariable(item.assignTo, val);
        }
      }
    }

    // PUT
    if (options.put) {
      for (const item of options.put) {
        if (item.key) {
          let val = item.value ?? "";
          if (item.ref) {
            val = context.getVariable(item.ref) ?? "";
          }
          map[item.key] = val;
        }
      }
    }

    // DELETE
    if (options.delete) {
      for (const key of options.delete) {
        delete map[key];
      }
    }
  }

  /**
   * VerifyAPIKey Policy implementation
   */
  static async verifyApiKey(options: VerifyApiKeyOptions, context: ApigeeContext): Promise<void> {
    if (!options) return;

    let keyValue = "";
    if (options.keyRef) {
      keyValue = context.getVariable(options.keyRef);
    } else if (options.keyValue) {
      keyValue = options.keyValue;
    } else {
      keyValue = context.request.getHeader("x-api-key") || context.request.getQueryParam("apikey") || "";
    }

    const policyName = options.policyName || "VerifyAPIKey";
    if (!keyValue) {
      context.setVariable(`verifyapikey.${policyName}.failed`, true);
      if (!options.continueOnError) {
        throw new Error(`API Key verification failed for policy ${policyName}: Missing API Key`);
      }
    } else {
      context.setVariable(`verifyapikey.${policyName}.failed`, false);
      context.setVariable(`verifyapikey.${policyName}.client_id`, keyValue);
    }
  }

  /**
   * DataCapture Policy implementation
   */
  static async dataCapture(options: DataCaptureOptions, context: ApigeeContext): Promise<void> {
    if (!options || !options.collectors) return;

    for (const col of options.collectors) {
      const val = (col.ref ? context.getVariable(col.ref) : undefined) ?? col.defaultValue ?? "";
      if (col.collectorName) {
        context.setVariable(`datacapture.${col.collectorName}`, val);
      }
    }
  }

  /**
   * RaiseFault Policy implementation
   */
  static async raiseFault(options: RaiseFaultOptions, context: ApigeeContext): Promise<void> {
    if (!options) return;

    if (options.statusCode) {
      context.response.status = options.statusCode;
    }
    if (options.reasonPhrase) {
      context.response.statusText = options.reasonPhrase;
    }
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        context.response.setHeader(k, context.resolveVariables(v));
      }
    }
    if (options.payload) {
      context.response.content = context.resolveVariables(options.payload);
    }

    const faultName = options.faultName || "RaiseFault";
    context.fault = {
      name: faultName,
      status: context.response.status,
    };

    throw new Error(`Fault raised: ${faultName}`);
  }
}
