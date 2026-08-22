import type { ApigeeContext } from "../apigee";

export interface RaiseFaultOptions {
  faultName?: string;
  statusCode?: number;
  reasonPhrase?: string;
  headers?: Record<string, string>;
  payload?: string;
}

/**
 * RaiseFault Policy implementation
 */
export async function raiseFault(options: RaiseFaultOptions, context: ApigeeContext): Promise<void> {
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
