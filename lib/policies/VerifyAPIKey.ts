import type { ApigeeContext } from "../apigee";

export interface VerifyApiKeyOptions {
  keyRef?: string;
  keyValue?: string;
  policyName?: string;
  continueOnError?: boolean;
}

/**
 * VerifyAPIKey Policy implementation
 */
export async function verifyApiKey(options: VerifyApiKeyOptions, context: ApigeeContext): Promise<void> {
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
