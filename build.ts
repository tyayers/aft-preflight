import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const PROXIES_DIR = "./proxies";
const TEMPLATES_DIR = "./templates";
const INDEX_FILE = "./index.ts";

function toArray<T>(item: T | T[] | undefined): T[] {
  if (item === undefined || item === null) return [];
  return Array.isArray(item) ? item : [item];
}

// Helper to extract policy configuration regardless of PascalCase / camelCase wrapper
function getPolicyConfig(policy: any) {
  if (!policy || !policy.content) return {};
  const type = policy.type;
  const content = policy.content;
  if (typeof content !== "object") return {};

  const keys = Object.keys(content);
  const matchedKey = keys.find((k) => k.toLowerCase() === type.toLowerCase());
  if (matchedKey && typeof content[matchedKey] === "object" && content[matchedKey] !== null) {
    return content[matchedKey];
  }
  return content;
}

// Helper to extract JavaScript source code
function getJavascriptSource(policy: any, resources: any[] = []): string {
  const config = getPolicyConfig(policy);
  if (config.Source || config.source) {
    return config.Source || config.source;
  }
  const resourceUrl =
    config.ResourceURL || config.resourceUrl || config.ResourceUrl || config.resourceURL;
  if (resourceUrl) {
    const resourceName = resourceUrl.replace(/^jsc:\/\//, "");
    const resource = resources.find((r: any) => r.name === resourceName);
    if (resource && resource.content) {
      return resource.content;
    }
  }
  const includeUrl = config.IncludeURL || config.includeUrl;
  if (includeUrl) {
    const resourceName = includeUrl.replace(/^jsc:\/\//, "");
    const resource = resources.find((r: any) => r.name === resourceName);
    if (resource && resource.content) {
      return resource.content;
    }
  }
  return "";
}

// Helper to extract ServiceCallout options
function extractServiceCalloutOptions(policy: any): any {
  const config = getPolicyConfig(policy);
  const targetConn = config.HTTPTargetConnection || config.httpTargetConnection;
  let url = targetConn?.URL || targetConn?.url;
  if (!url) {
    const localTarget = config.LocalTargetConnection || config.localTargetConnection;
    if (localTarget?.Path || localTarget?.path) {
      url = localTarget.Path || localTarget.path;
    }
  }

  const responseVar = config.Response || config.response || undefined;
  const requestConfig = config.Request || config.request;
  const requestVar = requestConfig?.metadata?.variable || requestConfig?.variable || undefined;
  const continueOnError =
    config.metadata?.continueOnError === "true" || config.metadata?.continueOnError === true;

  let headers: Record<string, string> | undefined = undefined;
  let payload: string | undefined = undefined;
  let method: string | undefined = undefined;

  const setBlock = requestConfig?.Set || requestConfig?.set;
  if (setBlock) {
    const headersContainer = setBlock.Headers || setBlock.headers;
    if (headersContainer) {
      const headerList = toArray(headersContainer.Header || headersContainer.header);
      headers = {};
      for (const h of headerList) {
        const hName = h.metadata?.name || h.name || h._name;
        const hVal = h._text ?? h.value ?? "";
        if (hName) headers[hName] = hVal;
      }
    }
    const payloadObj = setBlock.Payload || setBlock.payload;
    if (payloadObj) {
      payload = payloadObj._text ?? payloadObj.value ?? (typeof payloadObj === "string" ? payloadObj : "");
    }
    if (setBlock.Verb || setBlock.verb) {
      method = setBlock.Verb || setBlock.verb;
    }
  }

  const result: any = { url };
  if (method) result.method = method;
  if (headers && Object.keys(headers).length > 0) result.headers = headers;
  if (payload) result.payload = payload;
  if (requestVar) result.requestVar = requestVar;
  if (responseVar) result.responseVar = responseVar;
  if (continueOnError) result.continueOnError = true;

  return result;
}

// Helper to extract AssignMessage options
function extractAssignMessageOptions(policy: any): any {
  const config = getPolicyConfig(policy);
  const ignoreUnresolved =
    config.IgnoreUnresolvedVariables === true ||
    config.IgnoreUnresolvedVariables === "true" ||
    config.ignoreUnresolvedVariables === true ||
    config.ignoreUnresolvedVariables === "true";

  const assignTo = config.AssignTo || config.assignTo;
  let assignToTarget: string | undefined = undefined;
  if (typeof assignTo === "string") {
    assignToTarget = assignTo;
  } else if (assignTo && typeof assignTo === "object") {
    assignToTarget = assignTo.metadata?.type || assignTo._text || undefined;
  }

  const result: any = {};
  if (assignToTarget) result.assignTo = assignToTarget;
  if (ignoreUnresolved) result.ignoreUnresolvedVariables = true;

  // Set
  const setBlock = config.Set || config.set;
  if (setBlock) {
    const headersContainer = setBlock.Headers || setBlock.headers;
    if (headersContainer) {
      const headerList = toArray(headersContainer.Header || headersContainer.header);
      const setHeaders: Record<string, string> = {};
      for (const h of headerList) {
        const hName = h.metadata?.name || h.name || h._name;
        const hVal = h._text ?? h.value ?? (typeof h === "string" ? h : "");
        if (hName) setHeaders[hName] = hVal;
      }
      if (Object.keys(setHeaders).length > 0) result.setHeaders = setHeaders;
    }

    const queryParamsContainer = setBlock.QueryParams || setBlock.queryParams;
    if (queryParamsContainer) {
      const queryList = toArray(queryParamsContainer.QueryParam || queryParamsContainer.queryParam);
      const setQueryParams: Record<string, string> = {};
      for (const q of queryList) {
        const qName = q.metadata?.name || q.name || q._name;
        const qVal = q._text ?? q.value ?? (typeof q === "string" ? q : "");
        if (qName) setQueryParams[qName] = qVal;
      }
      if (Object.keys(setQueryParams).length > 0) result.setQueryParams = setQueryParams;
    }

    const payload = setBlock.Payload || setBlock.payload;
    if (payload !== undefined) {
      if (typeof payload === "string") {
        result.setPayload = payload;
      } else if (payload && typeof payload === "object") {
        const val = payload._text ?? payload.value ?? "";
        const contentType = payload.metadata?.contentType || payload.contentType;
        result.setPayload = contentType ? { value: val, contentType } : val;
      }
    }

    const statusCode = setBlock.StatusCode || setBlock.statusCode;
    if (statusCode !== undefined) {
      const num = parseInt(String(statusCode), 10);
      if (!isNaN(num)) result.setStatusCode = num;
    }

    const reasonPhrase = setBlock.ReasonPhrase || setBlock.reasonPhrase;
    if (reasonPhrase !== undefined) {
      result.setReasonPhrase = String(reasonPhrase);
    }
  }

  // Add
  const addBlock = config.Add || config.add;
  if (addBlock) {
    const headersContainer = addBlock.Headers || addBlock.headers;
    if (headersContainer) {
      const headerList = toArray(headersContainer.Header || headersContainer.header);
      const addHeaders: Record<string, string> = {};
      for (const h of headerList) {
        const hName = h.metadata?.name || h.name || h._name;
        const hVal = h._text ?? h.value ?? (typeof h === "string" ? h : "");
        if (hName) addHeaders[hName] = hVal;
      }
      if (Object.keys(addHeaders).length > 0) result.addHeaders = addHeaders;
    }
  }

  // Remove
  const removeBlock = config.Remove || config.remove;
  if (removeBlock) {
    const headersContainer = removeBlock.Headers || removeBlock.headers;
    if (headersContainer) {
      const headerList = toArray(headersContainer.Header || headersContainer.header);
      const removeHeaders: string[] = [];
      for (const h of headerList) {
        const hName = h.metadata?.name || h.name || h._name;
        if (hName) removeHeaders.push(hName);
      }
      if (removeHeaders.length > 0) result.removeHeaders = removeHeaders;
    }
    const queryParamsContainer = removeBlock.QueryParams || removeBlock.queryParams;
    if (queryParamsContainer) {
      const queryList = toArray(queryParamsContainer.QueryParam || queryParamsContainer.queryParam);
      const removeQueryParams: string[] = [];
      for (const q of queryList) {
        const qName = q.metadata?.name || q.name || q._name;
        if (qName) removeQueryParams.push(qName);
      }
      if (removeQueryParams.length > 0) result.removeQueryParams = removeQueryParams;
    }
  }

  // AssignVariable
  const assignVars = toArray(config.AssignVariable || config.assignVariable);
  if (assignVars.length > 0) {
    result.assignVariables = assignVars.map((av: any) => {
      const name = av.Name || av.name || av.metadata?.name;
      const ref = av.Ref || av.ref;
      const value = av.Value ?? av.value;
      const template = av.Template ?? av.template ?? av._text;
      return { name, ref, value, template };
    });
  }

  return result;
}

// Helper to extract VerifyAPIKey options
function extractVerifyApiKeyOptions(policy: any): any {
  const config = getPolicyConfig(policy);
  const apiKeyConfig = config.APIKey || config.apiKey || config.ApiKey;
  return {
    keyRef: apiKeyConfig?.ref || undefined,
    keyValue: apiKeyConfig?.value || apiKeyConfig?._text || undefined,
    policyName: config.metadata?.name || policy.name,
    continueOnError: config.metadata?.continueOnError === "true" || config.metadata?.continueOnError === true,
  };
}

// Helper to extract KeyValueMap options
function extractKeyValueMapOptions(policy: any): any {
  const config = getPolicyConfig(policy);
  const mapIdentifier = config.metadata?.mapIdentifier || config.mapIdentifier || "default";
  const result: any = { mapIdentifier };

  const getBlock = toArray(config.Get || config.get);
  if (getBlock.length > 0) {
    result.get = getBlock.map((item: any) => ({
      key: item.Key?.Parameter || item.key?.parameter || item.key || "",
      assignTo: item.assignTo || item.AssignTo || item.metadata?.assignTo || "",
    }));
  }

  const putBlock = toArray(config.Put || config.put);
  if (putBlock.length > 0) {
    result.put = putBlock.map((item: any) => {
      const setValue = item.setValue || item.SetValue || item.value || item.Value;
      const ref = typeof setValue === "object" ? setValue?.ref || setValue?.[0]?.ref : undefined;
      const val = typeof setValue === "string" ? setValue : undefined;
      return {
        key: item.Key?.Parameter || item.key?.parameter || item.key || "",
        value: val,
        ref: ref,
      };
    });
  }

  const deleteBlock = toArray(config.Delete || config.delete);
  if (deleteBlock.length > 0) {
    result.delete = deleteBlock.map((item: any) => item.Key?.Parameter || item.key?.parameter || item.key || "");
  }

  return result;
}

// Helper to convert string to PascalCase identifier
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^[a-z]/, (chr) => chr.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

// 1. Cleanup / ensure proxies directory
if (fs.existsSync(PROXIES_DIR)) {
  fs.readdirSync(PROXIES_DIR).forEach((file) => {
    fs.unlinkSync(path.join(PROXIES_DIR, file));
  });
} else {
  fs.mkdirSync(PROXIES_DIR, { recursive: true });
}

// 2. Prepare to rebuild index.ts
let indexImports = "";
let indexRoutes = "";

// 3. Process each yaml file in templates
const templates = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

for (const templateFile of templates) {
  const templateBaseName = path.basename(templateFile, path.extname(templateFile));
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, templateFile), "utf8");
  const data = yaml.load(content) as any;

  if (!data) continue;

  const endpoints = data.endpoints || (data.defaultEndpoint ? [data.defaultEndpoint] : []);
  if (!endpoints.length) continue;

  for (const endpoint of endpoints) {
    const basePath = endpoint.basePath;
    const targetName = endpoint.routes?.[0]?.target;
    const target = data.targets?.find((t: any) => t.name === targetName);
    const targetUrl = target?.url || target?.httpTargetConnection?.url || target?.httpTargetConnection?.URL;

    // Determine filenames and class names
    const fileBaseName = templateBaseName;
    const fileName = `${fileBaseName}.ts`;
    const className = `${toPascalCase(templateBaseName)}Proxy`;
    const functionName = `${templateBaseName.replace(/[^a-zA-Z0-9]/g, "_")}Proxy`;

    // Collect flow steps
    const requestSteps: string[] = [];
    const responseSteps: string[] = [];

    const processFlows = (flows: any[], isTarget: boolean = false) => {
      if (!flows) return;
      for (const flow of flows) {
        const mode = flow.mode || "";
        if (mode === "Request") {
          flow.steps?.forEach((s: any) => requestSteps.push(s.name));
        } else if (mode === "Response") {
          flow.steps?.forEach((s: any) => responseSteps.push(s.name));
        }
      }
    };

    // Apigee flow order: Endpoint Request -> Target Request -> Target Response -> Endpoint Response
    processFlows(endpoint.flows, false);
    if (target) {
      processFlows(target.flows, true);
    }

    // Collect all policies used in this endpoint and generate JS methods
    const allStepNames = Array.from(new Set([...requestSteps, ...responseSteps]));
    let jsMethods = "";

    for (const policyName of allStepNames) {
      const policy = data.policies?.find((p: any) => p.name === policyName);
      if (!policy) continue;

      if (policy.type === "Javascript") {
        const jsSource = getJavascriptSource(policy, data.resources || []);
        const methodName = policyName.replace(/[^a-zA-Z0-9]/g, "_");
        const formattedJsSource = jsSource
          .split("\n")
          .map((line) => (line.trim().length > 0 ? `    ${line.trimStart()}` : ""))
          .join("\n");

        jsMethods += `  async ${methodName}(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {\n    const print = console.log;\n${formattedJsSource}\n  }\n\n`;
      }
    }

    // Generate direct policy call for each step
    const generateStepCall = (stepName: string, indent: string = "      ", selfVar: string = "this") => {
      const policy = data.policies?.find((p: any) => p.name === stepName);
      if (!policy) return `${indent}// Unknown policy: ${stepName}`;

      if (policy.type === "Javascript") {
        const methodName = stepName.replace(/[^a-zA-Z0-9]/g, "_");
        return `${indent}await ${selfVar}.${methodName}(context, context.request, context.response);`;
      }

      if (policy.type === "ServiceCallout") {
        const options = extractServiceCalloutOptions(policy);
        return `${indent}await Apigee.serviceCallout(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent)}, context);`;
      }

      if (policy.type === "AssignMessage") {
        const options = extractAssignMessageOptions(policy);
        return `${indent}await Apigee.assignMessage(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent)}, context);`;
      }

      if (policy.type === "VerifyAPIKey") {
        const options = extractVerifyApiKeyOptions(policy);
        return `${indent}await Apigee.verifyApiKey(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent)}, context);`;
      }

      if (policy.type === "KeyValueMapOperations") {
        const options = extractKeyValueMapOptions(policy);
        return `${indent}await Apigee.keyValueMapOperations(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent)}, context);`;
      }

      return `${indent}// Policy: ${stepName} (${policy.type})`;
    };

    const requestPolicyExecutions = requestSteps.map((s) => generateStepCall(s)).join("\n");
    const responsePolicyExecutions = responseSteps.map((s) => generateStepCall(s)).join("\n");
    const streamingResponsePolicyExecutions = responseSteps
      .map((s) => generateStepCall(s, "              ", "self"))
      .join("\n");

    // Property set initialization from resources
    const propertySetInits = (data.resources || [])
      .filter((r: any) => r.type === "properties" || r.name?.endsWith(".properties"))
      .map((r: any) => {
        const propLines = (r.content || "").split("\n").filter((l: string) => l.includes("="));
        const prefix = r.name.replace(/\.properties$/, "").replace(/-/g, ".");
        return propLines
          .map((l: string) => {
            const [k, ...v] = l.split("=");
            const val = v.join("=").trim();
            return `context.setVariable("propertyset.${prefix}.${k ? k.trim() : ""}", ${JSON.stringify(val)});`;
          })
          .join("\n      ");
      })
      .filter(Boolean)
      .join("\n      ");

    const propertySetBlock = propertySetInits
      ? `      // Initialize propertyset variables from resources\n      ${propertySetInits}\n\n`
      : "";

    const requestFlowBlock = requestPolicyExecutions
      ? `      // 1. Run Request Flow Policies\n${requestPolicyExecutions}\n\n`
      : "";

    const responseFlowBlock = responsePolicyExecutions
      ? `      // 3. Run Response Flow Policies\n${responsePolicyExecutions}\n\n`
      : "";

    // Target call generation
    let targetExecution = "";
    if (targetUrl) {
      targetExecution = `      // 2. Execute Target Connection
      const path = Http.getPath(req.url, "${basePath}");
      const targetBaseUrl = "${targetUrl.replace(/\/+$/, "")}";
      const fullTargetUrl = path ? \`\${targetBaseUrl}/\${path}\` : targetBaseUrl;

      const headers = new Headers();
      const skipHeaders = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade"]);
      for (const [k, v] of Object.entries(context.request.headers)) {
        if (!skipHeaders.has(k.toLowerCase()) && v !== undefined && v !== null) {
          headers.set(k, v);
        }
      }

      const response = await fetch(fullTargetUrl, {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        tls: { rejectUnauthorized: false } as any,
      });

      context.response.status = response.status;
      context.response.statusText = response.statusText;
      for (const [k, v] of response.headers.entries()) {
        if (k.toLowerCase() !== "content-length") {
          context.response.setHeader(k, v);
        }
      }

      const targetContentType = response.headers.get("content-type") || "";
      if (Http.isStreaming(targetContentType)) {
        const self = this;
        const responseHeaders = {
          ...corsHeaders,
          ...context.response.headers,
        };
        return new Response(
          async function* () {
            if (response && response.body) {
              for await (const chunk of response.body) {
                const chunkString = Buffer.from(chunk).toString("utf-8");
                context.response.content = chunkString;
${streamingResponsePolicyExecutions ? streamingResponsePolicyExecutions + "\n" : ""}                yield context.response.rawContent;
              }
            }
          },
          {
            status: context.response.status,
            headers: responseHeaders,
          }
        );
      }

      if (Http.isText(targetContentType)) {
        context.response.content = await response.text();
      } else {
        context.response.content = new Uint8Array(await response.arrayBuffer());
      }\n\n`;
    }

    const proxyFileContent = `import { Apigee, ApigeeContext, ApigeeRequest, ApigeeResponse } from "../lib/apigee";
import { Http } from "../lib/http";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
};

export class ${className} {
${jsMethods}  async handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const context = new ApigeeContext(req);

    try {
${propertySetBlock}${requestFlowBlock}${targetExecution}${responseFlowBlock}      // 4. Return Response
      const responseHeaders = {
        ...corsHeaders,
        ...context.response.headers,
      };
      return new Response(context.response.rawContent, {
        status: context.response.status,
        headers: responseHeaders,
      });
    } catch (err: any) {
      if (context.fault) {
        const responseHeaders = {
          ...corsHeaders,
          ...context.response.headers,
        };
        return new Response(context.response.rawContent || err.message, {
          status: context.fault.status || context.response.status || 500,
          headers: responseHeaders,
        });
      }
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
        },
      });
    }
  }
}

export const ${fileBaseName.replace(/[^a-zA-Z0-9]/g, "_")}Instance = new ${className}();

export async function ${functionName}(req: Request): Promise<Response> {
  return ${fileBaseName.replace(/[^a-zA-Z0-9]/g, "_")}Instance.handle(req);
}
`;

    fs.writeFileSync(path.join(PROXIES_DIR, fileName), proxyFileContent);

    // Add to index info
    indexImports += `import { ${functionName} } from "./proxies/${fileBaseName}";\n`;
    indexRoutes += `    "${basePath}/*": ${functionName},\n    "${basePath}": ${functionName},\n`;
  }
}

// 4. Update index.ts
const indexContent = `import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { TemplateManager } from "./lib/TemplateManager";
${indexImports}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
};

async function parseTemplateRequestBody(req: Request): Promise<{ name?: string; content: string }> {
  const contentType = req.headers.get("content-type") || "";
  const rawText = await req.text();

  if (!rawText || !rawText.trim()) {
    throw new Error("Empty request body");
  }

  if (contentType.includes("application/json") || rawText.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.content === "string") {
          const name = parsed.name || parsed.id;
          return { name, content: parsed.content };
        } else if (typeof parsed.content === "object" && parsed.content !== null) {
          const name = parsed.name || parsed.id || parsed.content.name || parsed.content.id;
          return { name, content: yaml.dump(parsed.content) };
        } else if (parsed.name || parsed.id) {
          const name = parsed.name || parsed.id;
          return { name, content: yaml.dump(parsed) };
        }
      }
    } catch {
      // Fallback to YAML parsing below if JSON parsing fails
    }
  }

  let name: string | undefined;
  try {
    const doc = yaml.load(rawText) as any;
    if (doc && typeof doc === "object") {
      name = doc.name || doc.id;
    }
  } catch {
    // If not parseable as structured yaml, rawText will still be used as content
  }

  return { name, content: rawText };
}

const server = Bun.serve({
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
  routes: {
${indexRoutes}  },
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(req.url);

    // Add rebuild endpoint
    if (url.pathname === "/rebuild" && req.method === "POST") {
      console.log("Rebuild requested. Running build.ts...");
      try {
        const proc = Bun.spawn(["./bun", "run", "build.ts"]);

        return Response.json({ success: true, message: "Build successful. Service restarted!" }, { headers: corsHeaders });
      } catch (err: any) {
        console.error("Rebuild error:", err);
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // List templates
    if (url.pathname === "/api/templates" && req.method === "GET") {
      return Response.json(TemplateManager.list(), { headers: corsHeaders });
    }

    // Get specific template
    if (url.pathname.startsWith("/api/templates/") && req.method === "GET") {
      const id = url.pathname.split("/").pop()!;
      const content = TemplateManager.get(id);
      if (content === null) {
        return new Response("Template Not Found", { status: 404, headers: corsHeaders });
      }
      return new Response(content, { headers: { ...corsHeaders, "Content-Type": "text/yaml" } });
    }

    // Create a new template or update
    if ((url.pathname === "/api/templates" || url.pathname.startsWith("/api/templates/")) && req.method === "POST") {
      try {
        const pathId = url.pathname.startsWith("/api/templates/") ? url.pathname.split("/").pop() : undefined;
        const parsed = await parseTemplateRequestBody(req);
        const name = pathId || url.searchParams.get("name") || url.searchParams.get("id") || parsed.name;
        if (!name) {
          return Response.json({ success: false, error: "Missing template name in URL, query parameters, or YAML/JSON body" }, { status: 400, headers: corsHeaders });
        }
        TemplateManager.createOrUpdate(name, parsed.content);
        return Response.json({ success: true, name }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Update specific template
    if ((url.pathname === "/api/templates" || url.pathname.startsWith("/api/templates/")) && req.method === "PUT") {
      try {
        const pathId = url.pathname.startsWith("/api/templates/") ? url.pathname.split("/").pop() : undefined;
        const parsed = await parseTemplateRequestBody(req);
        const name = pathId || url.searchParams.get("name") || url.searchParams.get("id") || parsed.name;
        if (!name) {
          return Response.json({ success: false, error: "Missing template name in URL, query parameters, or YAML/JSON body" }, { status: 400, headers: corsHeaders });
        }
        TemplateManager.createOrUpdate(name, parsed.content);
        return Response.json({ success: true, name }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Delete specific template
    if (url.pathname.startsWith("/api/templates/") && req.method === "DELETE") {
      const id = url.pathname.split("/").pop()!;
      const deleted = TemplateManager.delete(id);
      if (!deleted) {
        return Response.json({ success: false, error: "Template not found" }, { status: 404, headers: corsHeaders });
      }
      return Response.json({ success: true }, { headers: corsHeaders });
    }

    let filePath = "./public" + url.pathname;
    if (url.pathname === "/") filePath = "./public/index.html";

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, { headers: corsHeaders });
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
});

console.log(\`Listening on \${server.url}\`);
`;

fs.writeFileSync(INDEX_FILE, indexContent);

console.log("Build complete!");
