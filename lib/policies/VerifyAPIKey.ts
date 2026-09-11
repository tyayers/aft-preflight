import type { ApigeeContext } from "../apigee";

export interface VerifyApiKeyOptions {
  keyRef?: string;
  keyValue?: string;
  policyName?: string;
  continueOnError?: boolean;
}

/**
 * VerifyAPIKey Policy implementation
 * Lightweight local API key validator with full context variable population and fault raising
 */
export async function verifyApiKey(options: VerifyApiKeyOptions, context: ApigeeContext): Promise<void> {
  if (!options) return;

  const policyName = options.policyName || "VerifyAPIKey";
  let keyValue = "";

  if (options.keyRef) {
    keyValue = context.getVariable(options.keyRef);
  } else if (options.keyValue) {
    keyValue = options.keyValue;
  } else {
    keyValue =
      context.getVariable("request.header.x-ai-key") ||
      context.getVariable("request.header.x-api-key") ||
      context.request.getHeader("x-ai-key") ||
      context.request.getHeader("x-api-key") ||
      context.request.getQueryParam("apikey") ||
      "";
  }

  if (typeof keyValue === "string") {
    keyValue = keyValue.trim();
  }

  if (!keyValue) {
    context.setVariable(`verifyapikey.${policyName}.failed`, true);
    context.setVariable("fault.name", "InvalidApiKey");
    context.fault = {
      name: "InvalidApiKey",
      status: 401,
      policyName: policyName,
    };
    if (!options.continueOnError) {
      throw new Error(`InvalidApiKey: API Key verification failed for policy ${policyName}`);
    }
    return;
  }

  // Populate Apigee VerifyAPIKey variables
  context.setVariable(`verifyapikey.${policyName}.failed`, false);
  context.setVariable(`verifyapikey.${policyName}.client_id`, keyValue);
  context.setVariable(`verifyapikey.${policyName}.developer.app.name`, "LocalDeveloperApp");
  context.setVariable(`verifyapikey.${policyName}.developer.email`, context.getVariable("ai.developerEmail") || "developer@local.test");
  context.setVariable(`verifyapikey.${policyName}.apiproduct.name`, "AI-Services-Product");
  context.setVariable("client_id", keyValue);
}
