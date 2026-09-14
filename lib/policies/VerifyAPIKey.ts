import type { ApigeeContext } from "../apigee";
import { DataManager } from "../DataManager";

export interface VerifyApiKeyOptions {
  keyRef?: string;
  keyValue?: string;
  policyName?: string;
  continueOnError?: boolean;
}

/**
 * VerifyAPIKey Policy implementation
 * Validates API keys against local imported users and products in DataManager
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

  // Look up in loaded DataManager users
  const authMatch = DataManager.getUserByApiKey(keyValue);
  const totalUsers = DataManager.listUsers().length;

  if (authMatch) {
    const { user, app, credential } = authMatch;

    if (credential.status && credential.status.toLowerCase() !== "approved") {
      context.setVariable(`verifyapikey.${policyName}.failed`, true);
      context.setVariable("fault.name", "ConsumerKeyRevoked");
      context.fault = { name: "ConsumerKeyRevoked", status: 401, policyName };
      if (!options.continueOnError) throw new Error(`ConsumerKeyRevoked: Credential is not approved`);
      return;
    }

    if (app.status && app.status.toLowerCase() !== "approved") {
      context.setVariable(`verifyapikey.${policyName}.failed`, true);
      context.setVariable("fault.name", "ConsumerKeyRevoked");
      context.fault = { name: "ConsumerKeyRevoked", status: 401, policyName };
      if (!options.continueOnError) throw new Error(`ConsumerKeyRevoked: App is not approved`);
      return;
    }

    if (user.status && user.status.toLowerCase() !== "active") {
      context.setVariable(`verifyapikey.${policyName}.failed`, true);
      context.setVariable("fault.name", "DeveloperInactive");
      context.fault = { name: "DeveloperInactive", status: 401, policyName };
      if (!options.continueOnError) throw new Error(`DeveloperInactive: Developer account is inactive`);
      return;
    }

    const rawProducts = credential.products || credential.apiProducts || app.products || app.apiProducts || [];
    const productNames = Array.isArray(rawProducts) ? rawProducts : [rawProducts];
    const primaryProduct = productNames[0] || "DefaultProduct";

    context.setVariable(`verifyapikey.${policyName}.failed`, false);
    context.setVariable(`verifyapikey.${policyName}.client_id`, keyValue);
    context.setVariable(`verifyapikey.${policyName}.client_secret`, credential.consumerSecret || credential.secret || "");
    context.setVariable(`verifyapikey.${policyName}.app.name`, app.name || "DefaultApp");
    context.setVariable(`verifyapikey.${policyName}.developer.app.name`, app.name || "DefaultApp");
    context.setVariable(`verifyapikey.${policyName}.developer.id`, user.name || user.email);
    context.setVariable(`verifyapikey.${policyName}.developer.email`, user.email || "developer@local.test");
    context.setVariable(`verifyapikey.${policyName}.developer.username`, user.userName || user.name || "developer");
    context.setVariable(`verifyapikey.${policyName}.apiproduct.name`, primaryProduct);
    context.setVariable(`verifyapikey.${policyName}.apiproduct.name.list`, productNames.join(","));
    context.setVariable("client_id", keyValue);
    context.setVariable("client_secret", credential.consumerSecret || credential.secret || "");
    context.setVariable("developer.email", user.email || "developer@local.test");
    context.setVariable("developer.app.name", app.name || "DefaultApp");
    context.setVariable("developer.id", user.name || user.email);

    // Populate custom attributes
    if (user.attributes) {
      for (const attr of user.attributes) {
        if (attr && attr.name && attr.value !== undefined) {
          context.setVariable(`verifyapikey.${policyName}.${attr.name}`, attr.value);
        }
      }
    }
    if (app.attributes) {
      for (const attr of app.attributes) {
        if (attr && attr.name && attr.value !== undefined) {
          context.setVariable(`verifyapikey.${policyName}.${attr.name}`, attr.value);
        }
      }
    }
    if (credential.attributes) {
      for (const attr of credential.attributes) {
        if (attr && attr.name && attr.value !== undefined) {
          context.setVariable(`verifyapikey.${policyName}.${attr.name}`, attr.value);
        }
      }
    }
    return;
  }

  // If users are configured, but the provided key wasn't found -> reject
  if (totalUsers > 0) {
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

  // Fallback if no users have been imported yet
  context.setVariable(`verifyapikey.${policyName}.failed`, false);
  context.setVariable(`verifyapikey.${policyName}.client_id`, keyValue);
  context.setVariable(`verifyapikey.${policyName}.developer.app.name`, "LocalDeveloperApp");
  context.setVariable(`verifyapikey.${policyName}.developer.email`, context.getVariable("ai.developerEmail") || "developer@local.test");
  context.setVariable(`verifyapikey.${policyName}.apiproduct.name`, "AI-Services-Product");
  context.setVariable("client_id", keyValue);
}
