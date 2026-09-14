import type { ApigeeContext } from "../apigee";
import { getGoogleAccessToken } from "../googleAuth";

export interface AssignVariableConfig {
  name: string;
  value?: any;
  ref?: string;
  template?: string;
}

export interface AssignAuthenticationConfig {
  headerName?: string;
  googleAccessToken?: {
    scopes?: string[];
  };
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
  setAuthentication?: AssignAuthenticationConfig;
  assignVariables?: AssignVariableConfig[];
  assignTo?: "request" | "response" | string;
  ignoreUnresolvedVariables?: boolean;
}

/**
 * AssignMessage Policy implementation
 * Sets, adds, removes headers/queryparams/payload, or sets variables and auth tokens
 */
export async function assignMessage(options: AssignMessageOptions, context: ApigeeContext): Promise<void> {
  if (!options) return;

  const ignoreUnresolved = options.ignoreUnresolvedVariables ?? true;
  const assignTo = (options.assignTo || "response").toLowerCase();

  // 1. Set Headers
  if (options.setHeaders) {
    for (const [name, val] of Object.entries(options.setHeaders)) {
      const resolvedVal = context.resolveVariables(val, ignoreUnresolved);
      if (assignTo === "request") {
        context.request.setHeader(name, resolvedVal);
        if (options.setStatusCode !== undefined || context.fault) {
          context.response.setHeader(name, resolvedVal);
        }
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

  // 6. Set Authentication (e.g. GoogleAccessToken)
  if (options.setAuthentication) {
    const headerName = options.setAuthentication.headerName || "Authorization";
    let googleToken = await getGoogleAccessToken();
    if (!googleToken || googleToken === "mock-google-cloud-token") {
      googleToken =
        process.env.GOOGLE_ACCESS_TOKEN ||
        process.env.GCP_ACCESS_TOKEN ||
        context.getVariable("request.header.authorization") ||
        googleToken ||
        "mock-google-cloud-token";
    }
    const bearerVal = googleToken.startsWith("Bearer ") ? googleToken : `Bearer ${googleToken}`;
    if (assignTo === "request") {
      context.request.setHeader(headerName, bearerVal);
    } else {
      context.response.setHeader(headerName, bearerVal);
    }
  }

  // 7. Set Payload
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
      // If setting error payload or statusCode in fault rule, populate response too
      if (options.setStatusCode !== undefined || context.fault) {
        context.response.content = resolvedPayload;
        if (contentType) context.response.setHeader("content-type", contentType);
      }
    } else if (assignTo === "response") {
      context.response.content = resolvedPayload;
      if (contentType) context.response.setHeader("content-type", contentType);
    } else {
      context.setVariable(`${options.assignTo}.content`, resolvedPayload);
    }
  }

  // 8. Set StatusCode & ReasonPhrase
  if (options.setStatusCode !== undefined) {
    context.response.status = options.setStatusCode;
    context.setVariable("response.status.code", options.setStatusCode);
    context.setVariable("message.status.code", options.setStatusCode);
  }
  if (options.setReasonPhrase !== undefined) {
    context.response.statusText = options.setReasonPhrase;
  }

  // 9. AssignVariables
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
