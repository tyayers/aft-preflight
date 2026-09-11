import type { ApigeeContext } from "../apigee";
import yaml from "js-yaml";

export interface OASValidationOptions {
  oasResource?: string;
  validateMessageBody?: boolean;
  validateHeaders?: boolean;
  validateQueryParams?: boolean;
  continueOnError?: boolean;
  policyName?: string;
  schemaContent?: string;
}

// Global resource store for proxies to access loaded OpenAPI specs, properties, etc.
export const globalResourceStore: Record<string, string> = {};

/**
 * OASValidation Policy implementation
 * Lightweight local validation of OpenAPI specs
 */
export async function oasValidation(options: OASValidationOptions, context: ApigeeContext): Promise<void> {
  if (!options) return;

  const policyName = options.policyName || "OAS-Validation";
  const resourceName = (options.oasResource || "").replace(/^oas:\/\//, "").trim();

  let specContent = options.schemaContent || (resourceName ? globalResourceStore[resourceName] : undefined);
  if (!specContent && resourceName) {
    // Try to check context variables
    specContent = context.getVariable(`_resource.${resourceName}`);
  }

  // If ValidateMessageBody is requested
  if (options.validateMessageBody !== false) {
    const rawBody = context.request.rawContent;
    let bodyObj: any = null;

    if (rawBody) {
      if (typeof rawBody === "object" && !(rawBody instanceof Uint8Array || rawBody instanceof ArrayBuffer)) {
        bodyObj = rawBody;
      } else if (typeof rawBody === "string" && rawBody.trim()) {
        try {
          bodyObj = JSON.parse(rawBody);
        } catch {
          // If non-JSON body when JSON is expected
          const contentType = context.request.getHeader("content-type") || "";
          if (contentType.includes("json")) {
            const err = new Error(`Malformed JSON in request body`);
            context.setVariable(`oasvalidation.${policyName}.failed`, true);
            context.setVariable(`oasvalidation.${policyName}.reason`, err.message);
            context.fault = { name: "OASValidationFailed", status: 400 };
            if (!options.continueOnError) throw err;
          }
        }
      }
    }

    // If OpenAPI spec is present, perform basic schema structure validation
    if (specContent && bodyObj) {
      try {
        const spec = typeof specContent === "string" ? (yaml.load(specContent) as any) : specContent;
        // Check if there are required fields in paths or schemas
        const schema = spec?.paths?.["/"]?.post?.requestBody?.content?.["application/json"]?.schema;
        if (schema && schema.required && Array.isArray(schema.required)) {
          for (const reqField of schema.required) {
            if (bodyObj[reqField] === undefined || bodyObj[reqField] === null) {
              const err = new Error(`Missing required field in request body: ${reqField}`);
              context.setVariable(`oasvalidation.${policyName}.failed`, true);
              context.setVariable(`oasvalidation.${policyName}.reason`, err.message);
              context.fault = { name: "OASValidationFailed", status: 400 };
              if (!options.continueOnError) throw err;
            }
          }
        }
      } catch (err: any) {
        if (err.message?.includes("Missing required field")) {
          throw err;
        }
        // Non-fatal schema parse warning in local mode
        console.warn(`OASValidation warning:`, err.message);
      }
    }
  }

  context.setVariable(`oasvalidation.${policyName}.failed`, false);
}
