import type { ApigeeContext } from "../apigee";
import { Http } from "../http";

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

/**
 * ServiceCallout Policy implementation
 * Makes HTTP callout and populates context variables
 */
export async function serviceCallout(options: ServiceCalloutOptions, context: ApigeeContext): Promise<void> {
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

    const contentType = response.headers.get("content-type") || "";
    let responseContent: any;
    if (Http.isText(contentType)) {
      responseContent = await response.text();
    } else {
      responseContent = new Uint8Array(await response.arrayBuffer());
    }
    const responseHeaders = Object.fromEntries(response.headers.entries());

    // Populate context variables
    context.setVariable(`${responseVarName}.content`, responseContent);
    context.setVariable(`${responseVarName}.status.code`, response.status);
    context.setVariable(`${responseVarName}.reason.phrase`, response.statusText);

    for (const [headerKey, headerVal] of Object.entries(responseHeaders)) {
      context.setVariable(`${responseVarName}.header.${headerKey.toLowerCase()}`, headerVal);
    }

    context.setVariable(responseVarName, {
      status: response.status,
      headers: responseHeaders,
      content: responseContent,
    });
  } catch (err: any) {
    console.error(`ServiceCallout error for ${resolvedUrl}:`, err.message);
    if (!options.continueOnError) {
      throw err;
    }
  }
}
