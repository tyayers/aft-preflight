import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { DeploymentManager } from "./lib/DeploymentManager";

const PROXIES_DIR = path.resolve(process.cwd(), "proxies");
const DATA_PROXIES_DIR = path.resolve(process.cwd(), "data/proxies");
const TEMPLATES_DIR = path.resolve(process.cwd(), "data/templates");
const DEPLOYMENTS_DIR = path.resolve(process.cwd(), "data/deployments");
const INDEX_FILE = path.resolve(process.cwd(), "index.ts");

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

function findResource(resources: any[], urlOrName: string) {
  if (!urlOrName) return undefined;
  const clean = urlOrName.replace(/^jsc:\/\//, "").trim();
  return resources.find((r: any) => {
    const rName = (r.name || "").replace(/^jsc:\/\//, "").trim();
    return (
      rName === clean ||
      rName === `${clean}.js` ||
      `${rName}.js` === clean ||
      r.name === urlOrName
    );
  });
}

function getIncludeUrls(policy: any): string[] {
  const config = getPolicyConfig(policy);
  const sources = [
    config?.IncludeURL,
    config?.includeUrl,
    config?.IncludeUrl,
    config?.includeURL,
    config?.IncludeURLs,
    config?.includeUrls,
    policy?.content?.IncludeURL,
    policy?.content?.includeUrl,
    policy?.IncludeURL,
    policy?.includeUrl,
  ];

  const urls: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    const list = Array.isArray(src) ? src : [src];
    for (const item of list) {
      if (typeof item === "string" && item.trim()) {
        urls.push(item.trim());
      } else if (item && typeof item === "object") {
        const val = item._text ?? item.value ?? item.url ?? item.href ?? "";
        if (typeof val === "string" && val.trim()) {
          urls.push(val.trim());
        }
      }
    }
  }
  return Array.from(new Set(urls));
}

function extractFunctionNames(code: string): string[] {
  const fnNames: string[] = [];
  const functionRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(/g;
  let match;
  while ((match = functionRegex.exec(code)) !== null) {
    fnNames.push(match[1]);
  }
  const exportRegex = /exports\.([a-zA-Z0-9_$]+)\s*=/g;
  while ((match = exportRegex.exec(code)) !== null) {
    fnNames.push(match[1]);
  }
  return Array.from(new Set(fnNames));
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
    const resource = findResource(resources, resourceUrl);
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
        const hName = h.metadata?.name || h.name || h._name || h.Name;
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

  const authBlock = targetConn?.Authentication || targetConn?.authentication;
  const googleAccessToken = authBlock?.GoogleAccessToken || authBlock?.googleAccessToken;

  const result: any = { url };
  if (method) result.method = method;
  if (headers && Object.keys(headers).length > 0) result.headers = headers;
  if (payload) result.payload = payload;
  if (requestVar) result.requestVar = requestVar;
  if (responseVar) result.responseVar = responseVar;
  if (continueOnError) result.continueOnError = true;
  if (googleAccessToken) result.authentication = { googleAccessToken: true };

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
        const hName = h.metadata?.name || h.name || h._name || h.Name;
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
        const qName = q.metadata?.name || q.name || q._name || q.Name;
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

    const authBlock = setBlock.Authentication || setBlock.authentication;
    if (authBlock) {
      const headerName = authBlock.HeaderName || authBlock.headerName || "Authorization";
      const googleAccessToken = authBlock.GoogleAccessToken || authBlock.googleAccessToken;
      result.setAuthentication = {
        headerName,
        googleAccessToken: googleAccessToken ? {} : undefined,
      };
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
        const hName = h.metadata?.name || h.name || h._name || h.Name;
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
        const hName = h.metadata?.name || h.name || h._name || h.Name;
        if (hName) removeHeaders.push(hName);
      }
      if (removeHeaders.length > 0) result.removeHeaders = removeHeaders;
    }
    const queryParamsContainer = removeBlock.QueryParams || removeBlock.queryParams;
    if (queryParamsContainer) {
      const queryList = toArray(queryParamsContainer.QueryParam || queryParamsContainer.queryParam);
      const removeQueryParams: string[] = [];
      for (const q of queryList) {
        const qName = q.metadata?.name || q.name || q._name || q.Name;
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
    keyRef: apiKeyConfig?.metadata?.ref || apiKeyConfig?.ref || undefined,
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

// Helper to extract OASValidation options
function extractOasValidationOptions(policy: any): any {
  const config = getPolicyConfig(policy);
  const oasResource = config.OASResource || config.oasResource || config.OASResourceURL;
  const validateMessageBody =
    config.Options?.ValidateMessageBody !== "false" && config.Options?.ValidateMessageBody !== false;
  return {
    policyName: config.metadata?.name || policy.name,
    oasResource: typeof oasResource === "string" ? oasResource : oasResource?._text,
    validateMessageBody,
    continueOnError: config.metadata?.continueOnError === "true" || config.metadata?.continueOnError === true,
  };
}

// Helper to extract DataCapture options
function extractDataCaptureOptions(policy: any): any {
  const config = getPolicyConfig(policy);
  const captures = toArray(config.Capture || config.capture);
  const collectors: any[] = [];
  for (const cap of captures) {
    const collectorName = cap.DataCollector || cap.dataCollector || cap.name;
    const collect = cap.Collect || cap.collect;
    const ref = collect?.metadata?.ref || collect?.ref;
    const defaultValue = collect?.metadata?.default || collect?.default;
    if (collectorName) {
      collectors.push({ collectorName, ref, defaultValue });
    }
  }
  return {
    policyName: config.metadata?.name || policy.name,
    collectors,
    continueOnError: config.metadata?.continueOnError === "true" || config.metadata?.continueOnError === true,
  };
}

// Helper to extract RaiseFault options
function extractRaiseFaultOptions(policy: any): any {
  const config = getPolicyConfig(policy);
  const faultResponse = config.FaultResponse || config.faultResponse;
  const setBlock = faultResponse?.Set || faultResponse?.set;
  const statusCode = setBlock?.StatusCode || setBlock?.statusCode || 500;
  const reasonPhrase = setBlock?.ReasonPhrase || setBlock?.reasonPhrase || "Internal Server Error";
  const payload = setBlock?.Payload?._text || setBlock?.Payload || setBlock?.payload || "";

  return {
    policyName: config.metadata?.name || policy.name,
    statusCode: parseInt(String(statusCode), 10) || 500,
    reasonPhrase: String(reasonPhrase),
    payload: String(payload),
  };
}

// Helper to convert string to PascalCase identifier
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^[a-z]/, (chr) => chr.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

export interface BuildOptions {
  deferWrites?: number;
}

let activeBuildPromise: Promise<{ success: boolean; count: number; proxies: string[] }> | null = null;

export async function runBuild(options?: BuildOptions): Promise<{ success: boolean; count: number; proxies: string[] }> {
  if (activeBuildPromise) {
    return activeBuildPromise;
  }
  activeBuildPromise = executeBuild(options).finally(() => {
    activeBuildPromise = null;
  });
  return activeBuildPromise;
}

async function executeBuild(options?: BuildOptions): Promise<{ success: boolean; count: number; proxies: string[] }> {
  // 1. Ensure required directories exist
  if (!fs.existsSync(PROXIES_DIR)) fs.mkdirSync(PROXIES_DIR, { recursive: true });
  if (!fs.existsSync(DEPLOYMENTS_DIR)) fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  if (!fs.existsSync(DATA_PROXIES_DIR)) fs.mkdirSync(DATA_PROXIES_DIR, { recursive: true });
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

  // 1b. Remove all proxy classes in proxies/ before rebuilding to ensure clean state
  if (fs.existsSync(PROXIES_DIR)) {
    for (const file of fs.readdirSync(PROXIES_DIR)) {
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        try {
          fs.unlinkSync(path.join(PROXIES_DIR, file));
        } catch (err: any) {
          console.warn(`[build] Warning removing old proxy class ${file}:`, err.message);
        }
      }
    }
  }

  // 2. Compile all data/deployments as input structure:
  // Parse all deployment files, generate proxy yamls from templates and proxies, then generate proxy code
  try {
    await DeploymentManager.generateProxiesFromDeployments();
  } catch (err: any) {
    console.warn("[build] Warning generating proxies from deployments:", err.message);
  }

  const generatedFiles = new Set<string>();
  const pendingWrites: Array<{ path: string; content: string }> = [];

  // 3. Prepare to rebuild index.ts
  let indexImports = "";
  let indexRoutes = "";
  const compiledProxies: string[] = [];
  const importedFunctions = new Set<string>();

  // 4. Process each yaml file in data/proxies and data/templates
  interface ProxySource {
    dir: string;
    file: string;
  }
  const sources: ProxySource[] = [];
  const seenFiles = new Set<string>();

  if (fs.existsSync(DATA_PROXIES_DIR)) {
    const pFiles = fs.readdirSync(DATA_PROXIES_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of pFiles) {
      sources.push({ dir: DATA_PROXIES_DIR, file: f });
      seenFiles.add(f);
    }
  }

  if (fs.existsSync(TEMPLATES_DIR)) {
    const tFiles = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of tFiles) {
      if (!seenFiles.has(f)) {
        sources.push({ dir: TEMPLATES_DIR, file: f });
        seenFiles.add(f);
      }
    }
  }

  for (const src of sources) {
    const templateFile = src.file;
    const templateBaseName = path.basename(templateFile, path.extname(templateFile));
    const content = fs.readFileSync(path.join(src.dir, templateFile), "utf8");
    const data = yaml.load(content) as any;

    if (!data) continue;

    const endpoints = data.endpoints || (data.defaultEndpoint ? [data.defaultEndpoint] : []);
    if (!endpoints.length) continue;

    for (let epIndex = 0; epIndex < endpoints.length; epIndex++) {
      const endpoint = endpoints[epIndex];
      let basePath = endpoint.basePath || `/${templateBaseName}`;
      if (!basePath.startsWith("/")) basePath = "/" + basePath;
      if (basePath.endsWith("/") && basePath.length > 1) basePath = basePath.slice(0, -1);

      // Determine filenames and class names
      const endpointSuffix = endpoints.length > 1 ? `_${endpoint.name || epIndex}` : "";
      const fileBaseName = `${templateBaseName}${endpointSuffix}`;
      const fileName = `${fileBaseName}.ts`;
      const className = `${toPascalCase(templateBaseName)}${toPascalCase(endpointSuffix)}Proxy`;
      const functionName = `${templateBaseName.replace(/[^a-zA-Z0-9]/g, "_")}${endpointSuffix.replace(/[^a-zA-Z0-9]/g, "_")}Proxy`;

    // Collect flow step references with conditions
    interface FlowStep {
      name: string;
      condition?: string;
    }

    const requestSteps: FlowStep[] = [];
    const responseSteps: FlowStep[] = [];
    const faultSteps: FlowStep[] = [];
    const targetPreFlowSteps: FlowStep[] = [];
    const targetPostFlowSteps: FlowStep[] = [];
    const targetEventFlowSteps: FlowStep[] = [];
    const targetFaultSteps: FlowStep[] = [];

    const processFlows = (flows: any[], reqArr: FlowStep[], resArr: FlowStep[]) => {
      if (!flows) return;
      for (const flow of flows) {
        const mode = flow.mode || "";
        if (mode === "Request") {
          flow.steps?.forEach((s: any) => reqArr.push({ name: s.name, condition: s.condition }));
        } else if (mode === "Response") {
          flow.steps?.forEach((s: any) => resArr.push({ name: s.name, condition: s.condition }));
        }
      }
    };

    // Collect endpoint flows
    processFlows(endpoint.flows, requestSteps, responseSteps);

    // Collect endpoint fault rules
    const faultRules = endpoint.faultRules || [];
    for (const fr of faultRules) {
      if (fr.steps) {
        fr.steps.forEach((s: any) => faultSteps.push({ name: s.name, condition: s.condition || fr.condition }));
      }
    }
    const defaultFaultRule = endpoint.defaultFaultRule || data.defaultFaultRule;
    if (defaultFaultRule?.steps) {
      defaultFaultRule.steps.forEach((s: any) => faultSteps.push({ name: s.name, condition: s.condition }));
    }

    // Collect target flows across targets
    for (const t of data.targets || []) {
      if (t.flows) {
        for (const f of t.flows) {
          if (f.name === "PreFlow" && f.mode === "Request") {
            f.steps?.forEach((s: any) => targetPreFlowSteps.push({ name: s.name, condition: s.condition }));
          } else if (f.name === "PostFlow" && f.mode === "Response") {
            f.steps?.forEach((s: any) => targetPostFlowSteps.push({ name: s.name, condition: s.condition }));
          } else if (f.name === "EventFlow" && f.mode === "Response") {
            f.steps?.forEach((s: any) => targetEventFlowSteps.push({ name: s.name, condition: s.condition }));
          }
        }
      }
      if (t.defaultFaultRule?.steps) {
        t.defaultFaultRule.steps.forEach((s: any) => targetFaultSteps.push({ name: s.name, condition: s.condition }));
      }
    }

    // Deduplicate target flow steps by name + condition
    const dedupeSteps = (steps: FlowStep[]) => {
      const seen = new Set<string>();
      return steps.filter((s) => {
        const key = `${s.name}:${s.condition || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const uniqueTargetPreFlowSteps = dedupeSteps(targetPreFlowSteps);
    const uniqueTargetPostFlowSteps = dedupeSteps(targetPostFlowSteps);
    const uniqueTargetEventFlowSteps = dedupeSteps(targetEventFlowSteps);
    const uniqueTargetFaultSteps = dedupeSteps(targetFaultSteps);

    // Collect all IncludeURL resources referenced by Javascript policies
    const includedResourceNames = new Set<string>();
    for (const policy of data.policies || []) {
      if (policy.type === "Javascript") {
        const urls = getIncludeUrls(policy);
        urls.forEach((u) => includedResourceNames.add(u));
      }
    }

    let includedResourcesCode = "";
    const exposedClassFunctions: string[] = [];

    for (const resUrl of includedResourceNames) {
      const res = findResource(data.resources || [], resUrl);
      if (res && res.content) {
        const sanitizedContent = res.content.replace(/\brequire\s*\(\s*(['"][^'"]+['"])\s*\)/g, "globalThis.require?.(String($1))");
        includedResourcesCode += `// --- Included Resource: ${res.name || resUrl} ---\n${sanitizedContent}\n\n`;
        const fnNames = extractFunctionNames(res.content);
        exposedClassFunctions.push(...fnNames);
      }
    }

    const uniqueExposedFns = Array.from(new Set(exposedClassFunctions));
    const classFunctionAssignments =
      uniqueExposedFns.length > 0
        ? `  // Callable IncludeURL functions\n${uniqueExposedFns.map((fn) => `  ${fn} = ${fn};`).join("\n")}\n\n`
        : "";

    // Collect all JS policies and generate JS methods
    const allStepNames = Array.from(
      new Set([
        ...requestSteps.map((s) => s.name),
        ...responseSteps.map((s) => s.name),
        ...faultSteps.map((s) => s.name),
        ...uniqueTargetPreFlowSteps.map((s) => s.name),
        ...uniqueTargetPostFlowSteps.map((s) => s.name),
        ...uniqueTargetEventFlowSteps.map((s) => s.name),
        ...uniqueTargetFaultSteps.map((s) => s.name),
        ...(data.policies || []).filter((p: any) => p.type === "Javascript").map((p: any) => p.name),
      ])
    );
    let jsMethods = "";

    for (const policyName of allStepNames) {
      const policy = data.policies?.find((p: any) => p.name === policyName);
      if (!policy) continue;

      if (policy.type === "Javascript") {
        const jsSource = getJavascriptSource(policy, data.resources || []);
        const sanitizedJsSource = jsSource
          .replace(/\brequire\s*\(\s*(['"][^'"]+['"])\s*\)/g, "globalThis.require?.(String($1))")
          .replace(/^\s*print\s*\(\s*(contentString|response\.content|response\.event\.current\.content|response\.data|.*Analytics data.*)\s*\)\s*;?\s*$/gm, "");
        const methodName = policyName.replace(/[^a-zA-Z0-9]/g, "_");
        const formattedJsSource = sanitizedJsSource
          .split("\n")
          .map((line) => (line.trim().length > 0 ? `    ${line.trimStart()}` : ""))
          .join("\n");

        jsMethods += `  async ${methodName}(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {\n    const print = (...args: any[]) => {\n      const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));\n      const filtered = args.filter(a => !isResp(a));\n      if (filtered.length > 0) console.log(...filtered);\n    };\n${formattedJsSource}\n  }\n\n`;
      }
    }

    // Generate direct policy call for each step (with condition evaluation and tracing)
    const generateStepCall = (
      step: FlowStep,
      indent: string = "      ",
      selfVar: string = "this",
      flowName: string = "Flow"
    ) => {
      const stepName = step.name;
      const stepCondition = step.condition;
      const policy = data.policies?.find((p: any) => p.name === stepName);
      if (!policy) return `${indent}// Unknown policy: ${stepName}`;

      let callCode = "";
      if (policy.type === "Javascript") {
        const methodName = stepName.replace(/[^a-zA-Z0-9]/g, "_");
        callCode = `await ${selfVar}.${methodName}(context, context.request, context.response);`;
      } else if (policy.type === "ServiceCallout") {
        const options = extractServiceCalloutOptions(policy);
        callCode = `await Apigee.serviceCallout(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent + "  ")}, context);`;
      } else if (policy.type === "AssignMessage") {
        const options = extractAssignMessageOptions(policy);
        callCode = `await Apigee.assignMessage(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent + "  ")}, context);`;
      } else if (policy.type === "VerifyAPIKey") {
        const options = extractVerifyApiKeyOptions(policy);
        callCode = `await Apigee.verifyApiKey(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent + "  ")}, context);`;
      } else if (policy.type === "KeyValueMapOperations") {
        const options = extractKeyValueMapOptions(policy);
        callCode = `await Apigee.keyValueMapOperations(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent + "  ")}, context);`;
      } else if (policy.type === "OASValidation") {
        const options = extractOasValidationOptions(policy);
        callCode = `await Apigee.oasValidation(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent + "  ")}, context);`;
      } else if (policy.type === "DataCapture") {
        const options = extractDataCaptureOptions(policy);
        callCode = `await Apigee.dataCapture(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent + "  ")}, context);`;
      } else if (policy.type === "RaiseFault") {
        const options = extractRaiseFaultOptions(policy);
        callCode = `await Apigee.raiseFault(${JSON.stringify(options, null, 2).replace(/\n/g, "\n" + indent + "  ")}, context);`;
      } else {
        callCode = `// Policy: ${stepName} (${policy.type})`;
      }

      const tracedCall = `await context.traceStep(${JSON.stringify(stepName)}, ${JSON.stringify(policy.type)}, ${JSON.stringify(flowName)}, async () => {\n${indent}  ${callCode}\n${indent}});`;

      if (stepCondition && stepCondition.trim()) {
        return `${indent}if (Apigee.evaluateCondition(${JSON.stringify(stepCondition)}, context)) {\n${indent}  ${tracedCall}\n${indent}} else {\n${indent}  context.recordSkippedStep(${JSON.stringify(stepName)}, ${JSON.stringify(policy.type)}, ${JSON.stringify(flowName)}, ${JSON.stringify(stepCondition)});\n${indent}}`;
      }
      return `${indent}${tracedCall}`;
    };

    const requestPolicyExecutions = requestSteps.map((s) => generateStepCall(s, "      ", "this", "Request Flow")).join("\n");
    const responsePolicyExecutions = responseSteps.map((s) => generateStepCall(s, "      ", "this", "Response Flow")).join("\n");
    const targetPreFlowExecutions = uniqueTargetPreFlowSteps.map((s) => generateStepCall(s, "      ", "this", "Target PreFlow")).join("\n");
    const targetPostFlowExecutions = uniqueTargetPostFlowSteps.map((s) => generateStepCall(s, "      ", "this", "Target PostFlow")).join("\n");
    const targetFaultExecutions = uniqueTargetFaultSteps.map((s) => generateStepCall(s, "        ", "this", "Target Fault")).join("\n");
    const streamingTargetEventFlowExecutions = uniqueTargetEventFlowSteps
      .map((s) => generateStepCall(s, "                ", "self", "Target EventFlow"))
      .join("\n");
    const streamingResponsePolicyExecutions = responseSteps
      .map((s) => generateStepCall(s, "              ", "self", "Streaming Response Flow"))
      .join("\n");

    const faultRuleExecutions = faultSteps.map((s) => generateStepCall(s, "        ", "this", "FaultRules")).join("\n");

    // Register all template resources into globalResourceStore
    let resourceStoreInits = "";
    for (const res of data.resources || []) {
      if (res.name && res.content) {
        resourceStoreInits += `globalResourceStore[${JSON.stringify(res.name)}] = ${JSON.stringify(res.content)};\n`;
      }
    }

    // Property set initialization from resources & parameters
    const propLinesArr: string[] = [];
    for (const r of data.resources || []) {
      if (r.type === "properties" || r.name?.endsWith(".properties")) {
        const lines = (r.content || "").split("\n").filter((l: string) => l.includes("="));
        const prefix = r.name.replace(/\.properties$/, "").replace(/-/g, ".");
        for (const l of lines) {
          const [k, ...v] = l.split("=");
          const val = v.join("=").trim();
          propLinesArr.push(`context.setVariable("propertyset.${prefix}.${k ? k.trim() : ""}", ${JSON.stringify(val)});`);
        }
      }
    }
    for (const param of data.parameters || []) {
      if (param.name && param.default !== undefined) {
        propLinesArr.push(`if (context.getVariable("propertyset.ai.${param.name}") === undefined) { context.setVariable("propertyset.ai.${param.name}", ${JSON.stringify(param.default)}); }`);
      }
    }

    const propertySetBlock =
      propLinesArr.length > 0
        ? `      // Initialize propertyset variables\n      ${propLinesArr.join("\n      ")}\n\n`
        : "";

    const requestFlowBlock = requestPolicyExecutions
      ? `      // 1. Run Request Flow Policies\n${requestPolicyExecutions}\n\n`
      : "";

    const responseFlowBlock = responsePolicyExecutions
      ? `      // 3. Run Endpoint Response Flow Policies\n${responsePolicyExecutions}\n\n`
      : "";

    // Route and Targets generation
    const routesConfig = (endpoint.routes || []).map((r: any) => ({
      name: r.name,
      condition: r.condition,
      target: r.target,
    }));

    const targetsMap: Record<string, any> = {};
    for (const t of data.targets || []) {
      const tUrl = t.url || t.httpTargetConnection?.url || t.httpTargetConnection?.URL || "";
      targetsMap[t.name] = {
        name: t.name,
        url: tUrl,
      };
    }

    // Default target selection
    const defaultTargetName = endpoint.routes?.[0]?.target || Object.keys(targetsMap)[0];
    const defaultTargetUrl = defaultTargetName ? targetsMap[defaultTargetName]?.url || "" : "";

    let targetExecution = "";
    if (Object.keys(targetsMap).length > 0 || defaultTargetUrl) {
      targetExecution = `      // 2. Select and Execute Target Connection
      const path = Http.getPath(req.url, "${basePath}");
      const routes = ${JSON.stringify(routesConfig, null, 2).replace(/\n/g, "\n      ")};
      const targetsMap: Record<string, any> = ${JSON.stringify(targetsMap, null, 2).replace(/\n/g, "\n      ")};

      let selectedTargetName = "${defaultTargetName || ""}";
      for (const route of routes) {
        if (!route.condition || Apigee.evaluateCondition(route.condition, context)) {
          if (route.target) {
            selectedTargetName = route.target;
            break;
          }
        }
      }

      let targetObj = targetsMap[selectedTargetName];
      if (!targetObj && (selectedTargetName === "default" || !targetsMap[selectedTargetName])) {
        targetObj = targetsMap["${defaultTargetName}"] || Object.values(targetsMap)[0];
      }
      const rawTargetUrl = targetObj?.url || "${defaultTargetUrl}";
      const resolvedTargetBaseUrl = context.resolveVariables(rawTargetUrl).replace(/\\/+$/, "");
      const fullTargetUrl = path ? \`\${resolvedTargetBaseUrl}/\${path}\` : resolvedTargetBaseUrl;
      if (!fullTargetUrl || !fullTargetUrl.trim()) {
        throw new Error(\`Target '\${selectedTargetName}' not found or has no URL defined in proxy/template.\`);
      }

${targetPreFlowExecutions ? `      // Target PreFlow\n${targetPreFlowExecutions}\n\n` : ""}      const headers = new Headers();
      const skipHeaders = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade"]);
      for (const [k, v] of Object.entries(context.request.headers)) {
        if (!skipHeaders.has(k.toLowerCase()) && v !== undefined && v !== null) {
          headers.set(k, v);
        }
      }

      let response: Response;
      const targetStartTime = Date.now();
      try {
        response = await fetch(fullTargetUrl, {
          method: req.method,
          headers,
          body: req.method !== "GET" && req.method !== "HEAD" ? context.request.rawContent : undefined,
          tls: { rejectUnauthorized: false } as any,
        });

        context.response.status = response.status;
        context.response.statusText = response.statusText;
        const skipResponseHeaders = new Set([
          "content-length",
          "content-encoding",
          "transfer-encoding",
          "connection",
          "keep-alive",
          "access-control-allow-origin",
          "access-control-allow-methods",
          "access-control-allow-headers",
          "access-control-expose-headers",
        ]);
        for (const [k, v] of response.headers.entries()) {
          if (!skipResponseHeaders.has(k.toLowerCase())) {
            context.response.setHeader(k, v);
          }
        }
        context.recordTargetCall({
          name: context.getVariable("target.name") || "default",
          url: fullTargetUrl,
          verb: req.method,
          status: response.status,
          durationMs: Date.now() - targetStartTime,
          requestHeaders: Object.fromEntries(headers.entries()),
          responseHeaders: Object.fromEntries(response.headers.entries()),
        });
      } catch (targetErr: any) {
        context.setVariable("target.failed", true);
        context.setVariable("target.error", targetErr.message);
        context.recordTargetCall({
          name: context.getVariable("target.name") || "default",
          url: fullTargetUrl,
          verb: req.method,
          status: 502,
          durationMs: Date.now() - targetStartTime,
          requestHeaders: Object.fromEntries(headers.entries()),
        });
${targetFaultExecutions ? `        // Target DefaultFaultRule\n${targetFaultExecutions}\n` : ""}        if (!context.response.content && context.response.status === 200) {
          response = new Response(JSON.stringify({ error: { message: targetErr.message, code: 502 } }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
          context.response.status = 502;
          context.response.setHeader("content-type", "application/json");
        } else {
          response = new Response(context.response.rawContent, {
            status: context.response.status,
            headers: context.response.headers,
          });
        }
      }

      const targetContentType = context.response.getHeader("content-type") || response?.headers?.get("content-type") || "";
      if (Http.isStreaming(targetContentType)) {
        const self = this;
        context.finalizeTrace();
        const responseHeaders = {
          ...corsHeaders,
          ...context.response.headers,
        };
        return new Response(
          async function* () {
            if (response && response.body) {
              try {
                for await (const chunk of response.body) {
                  const chunkString = Buffer.from(chunk).toString("utf-8");
                  context.response.content = chunkString;
${streamingTargetEventFlowExecutions ? streamingTargetEventFlowExecutions + "\n" : ""}${streamingResponsePolicyExecutions ? streamingResponsePolicyExecutions + "\n" : ""}                  const yielded = context.response.rawContent !== undefined && context.response.rawContent !== null
                    ? context.response.rawContent
                    : chunkString;
                  context.appendStreamChunk(yielded);
                  yield context.response.rawContent;
                }
              } finally {
                context.finalizeStreamTrace();
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
      }

${targetPostFlowExecutions ? `      // Target PostFlow\n${targetPostFlowExecutions}\n\n` : ""}`;
    }

    const proxyFileContent = `import {
  Apigee,
  ApigeeContext,
  ApigeeRequest,
  ApigeeResponse,
  globalResourceStore,
} from "../lib/apigee";
import { Http } from "../lib/http";
import { DataManager } from "../lib/DataManager";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
};

const print = (...args: any[]) => {
  const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
  const filtered = args.filter(a => !isResp(a));
  if (filtered.length > 0) console.log(...filtered);
};

// Always initialize DataManager to load YAMLs (deployments, products, kvm, users) on startup
DataManager.initializeSync();

${resourceStoreInits}
${includedResourcesCode}export class ${className} {
  constructor() {
    DataManager.initializeSync();
  }

${classFunctionAssignments}${jsMethods}  async handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const context = new ApigeeContext(req, {}, ${JSON.stringify(data.name)});

    if (req.method !== "GET" && req.method !== "HEAD") {
      const contentType = req.headers.get("content-type") || "";
      if (Http.isText(contentType)) {
        context.request.content = await req.text();
      } else {
        context.request.content = new Uint8Array(await req.arrayBuffer());
      }
    }

    try {
${propertySetBlock}${requestFlowBlock}${targetExecution}${responseFlowBlock}      // 4. Return Response
      context.finalizeTrace();
      const responseHeaders = {
        ...corsHeaders,
        ...context.response.headers,
      };
      if (context.response.rawContent && typeof context.response.rawContent.tee === "function") {
        const [clientStream, traceStream] = context.response.rawContent.tee();
        (async () => {
          try {
            const reader = traceStream.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunkStr = typeof value === "string" ? value : decoder.decode(value, { stream: true });
              context.appendStreamChunk(chunkStr);
            }
          } catch {} finally {
            context.finalizeStreamTrace();
          }
        })();
        return new Response(clientStream, {
          status: context.response.status,
          headers: responseHeaders,
        });
      }
      return new Response(context.response.rawContent, {
        status: context.response.status,
        headers: responseHeaders,
      });
    } catch (err: any) {
      if (!context.getVariable("fault.name")) {
        context.setVariable("fault.name", "ScriptExecutionFailed");
      }
      if (!context.fault) {
        context.fault = {
          name: context.getVariable("fault.name") || "ScriptExecutionFailed",
          status: 500,
          error: err?.message || String(err),
        };
      }
${faultRuleExecutions ? `      // Execute FaultRules\n${faultRuleExecutions}\n` : ""}      context.finalizeTrace();
      const responseHeaders = {
        ...corsHeaders,
        ...context.response.headers,
      };
      let faultStatus = context.fault?.status || (context.response.status !== 200 ? context.response.status : 500);
      let faultBody = context.response.rawContent;
      if (!faultBody || faultBody === "{}" || (context.response.status === 200 && !context.response.content)) {
        faultBody = JSON.stringify({ error: err?.message || String(err) });
      }
      return new Response(faultBody, {
        status: faultStatus,
        headers: responseHeaders,
      });
    }
  }
}

export const ${fileBaseName.replace(/[^a-zA-Z0-9]/g, "_")}Instance = new ${className}();

export async function ${functionName}(req: Request): Promise<Response> {
  return ${fileBaseName.replace(/[^a-zA-Z0-9]/g, "_")}Instance.handle(req);
}
`;

    const targetPath = path.join(PROXIES_DIR, fileName);
    pendingWrites.push({ path: targetPath, content: proxyFileContent });
    generatedFiles.add(fileName);

    // Add to index info
    if (!importedFunctions.has(functionName)) {
      importedFunctions.add(functionName);
      indexImports += `import { ${functionName} } from "./proxies/${fileBaseName}";\n`;
    }
    if (basePath === "/") {
      indexRoutes += `    "/*": ${functionName},\n    "/": ${functionName},\n`;
    } else {
      indexRoutes += `    "${basePath}/*": ${functionName},\n    "${basePath}": ${functionName},\n`;
    }
    compiledProxies.push(functionName);
  }
}

// 4. Update index.ts
const indexContent = `import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { TemplateManager } from "./lib/TemplateManager";
import { DataManager } from "./lib/DataManager";
import { DeploymentManager } from "./lib/DeploymentManager";
import { TraceManager } from "./lib/tracer";
import { runBuild } from "./build";
${indexImports}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
};

// Initialize DataManager on startup to load products, users, and KVM from data/
await DataManager.initialize();

async function parseTemplateRequestBody(rawText: string, contentType: string = ""): Promise<{ name?: string; content: string; isDeployment?: boolean }> {
  if (!rawText || !rawText.trim()) {
    throw new Error("Empty request body");
  }

  if (DeploymentManager.isDeployment(rawText)) {
    return { content: rawText, isDeployment: true };
  }

  if (contentType.includes("application/json") || rawText.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === "object") {
        if (DeploymentManager.isDeployment(parsed)) {
          return { content: rawText, isDeployment: true };
        }
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
      if (DeploymentManager.isDeployment(doc)) {
        return { content: rawText, isDeployment: true };
      }
      name = doc.name || doc.id;
    }
  } catch {
    // If not parseable as structured yaml, rawText will still be used as content
  }

  return { name, content: rawText };
}

const requestedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
function startBungeeServer(portNum: number) {
  return Bun.serve({
    port: portNum,
    routes: {
${indexRoutes}    },
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
        const buildRes = await runBuild({ deferWrites: 50 });
        await DataManager.initialize();
        return Response.json({ success: true, message: "Build successful. Service restarted!", ...buildRes }, { headers: corsHeaders });
      } catch (err: any) {
        console.error("Rebuild error:", err);
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Data API endpoints
    // GET /api/data -> summary of all files and counts
    if (url.pathname === "/api/data" && req.method === "GET") {
      return Response.json(DataManager.getDataSummary(), { headers: corsHeaders });
    }

    // POST /api/data/fetch-url -> download remote YAML and deploy
    if (url.pathname === "/api/data/fetch-url" && req.method === "POST") {
      try {
        const body = await req.json();
        const targetUrl = body.url || url.searchParams.get("url");
        if (!targetUrl) {
          return Response.json({ success: false, error: "url parameter required" }, { status: 400, headers: corsHeaders });
        }
        const resp = await fetch(targetUrl);
        if (!resp.ok) {
          return Response.json({ success: false, error: "Failed to fetch URL: " + resp.status + " " + resp.statusText }, { status: 400, headers: corsHeaders });
        }
        const rawYaml = await resp.text();
        const deployRes = await DeploymentManager.deploy(rawYaml, { build: false });
        return Response.json({ success: true, deployment: deployRes, summary: DataManager.getDataSummary() }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // POST /api/data/apply -> save accumulated changes, deploy deployments, run build
    if (url.pathname === "/api/data/apply" && req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        if (body.files && Array.isArray(body.files)) {
          for (const f of body.files) {
            DataManager.saveDataFile(f.section, f.filename, f.content);
          }
        }

        // Deploy all deployments in data/deployments/
        const depFiles = DataManager.listDataFiles("deployments");
        const deployedProxiesList: string[] = [];
        for (const df of depFiles) {
          const raw = DataManager.getDataFile("deployments", df);
          if (raw) {
            const depRes = await DeploymentManager.deploy(raw, { build: false });
            if (depRes.deployedProxies) {
              deployedProxiesList.push(...depRes.deployedProxies.map((p) => p.name));
            }
          }
        }

        const buildRes = await runBuild({ deferWrites: 50 });
        await DataManager.initialize();
        return Response.json({
          success: true,
          deployedProxies: deployedProxiesList,
          ...buildRes,
        }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // POST /api/data/files -> save single file
    if (url.pathname === "/api/data/files" && req.method === "POST") {
      try {
        const body = await req.json();
        const { section, filename, content } = body;
        if (!section || !filename || content === undefined) {
          return Response.json({ success: false, error: "section, filename, and content required" }, { status: 400, headers: corsHeaders });
        }
        DataManager.saveDataFile(section, filename, content);
        return Response.json({ success: true, summary: DataManager.getDataSummary() }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // DELETE /api/data/files -> delete single file
    if (url.pathname === "/api/data/files" && req.method === "DELETE") {
      try {
        const section = url.searchParams.get("section");
        const filename = url.searchParams.get("filename");
        if (!section || !filename) {
          return Response.json({ success: false, error: "section and filename parameters required" }, { status: 400, headers: corsHeaders });
        }
        const ok = DataManager.deleteDataFile(section, filename);
        return Response.json({ success: ok, summary: DataManager.getDataSummary() }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // GET /api/data/:section/:filename
    if (url.pathname.startsWith("/api/data/")) {
      const parts = url.pathname.slice("/api/data/".length).split("/");
      const section = parts[0];
      const filename = parts[1];
      if (section && filename) {
        const content = DataManager.getDataFile(section, filename);
        if (content === null) {
          return new Response("Not Found", { status: 404, headers: corsHeaders });
        }
        return new Response(content, { headers: { ...corsHeaders, "Content-Type": "text/yaml" } });
      }
    }

    // Deployments endpoint (POST deployment YAML or JSON)
    if ((url.pathname === "/api/deployments" || url.pathname === "/api/deployment" || url.pathname === "/deploy") && req.method === "POST") {
      try {
        const rawText = await req.text();
        const result = await DeploymentManager.deploy(rawText, { build: false });
        await DataManager.initialize();
        return Response.json(result, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err: any) {
        console.error("Deployment error:", err);
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    // POST /api/fetch-remote or GET /api/fetch-remote -> download remote YAML without immediate deploying
    if ((url.pathname === "/api/fetch-remote" || url.pathname === "/api/fetch-url") && (req.method === "POST" || req.method === "GET")) {
      try {
        let targetUrl = url.searchParams.get("url");
        if (req.method === "POST") {
          const body = await req.json().catch(() => ({}));
          targetUrl = body.url || targetUrl;
        }
        if (!targetUrl) {
          return Response.json({ success: false, error: "url parameter required" }, { status: 400, headers: corsHeaders });
        }
        const resp = await fetch(targetUrl);
        if (!resp.ok) {
          return Response.json({ success: false, error: "Failed to fetch URL: " + resp.status + " " + resp.statusText }, { status: 400, headers: corsHeaders });
        }
        const content = await resp.text();
        return Response.json({ success: true, url: targetUrl, content }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // POST /api/deployment/parse -> parses deployment YAML into JSON structure for UI overviews
    if (url.pathname === "/api/deployment/parse" && req.method === "POST") {
      try {
        const rawText = await req.text();
        let doc: any = null;
        try {
          doc = yaml.load(rawText);
        } catch {
          doc = JSON.parse(rawText);
        }
        return Response.json({ success: true, parsed: doc }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    // List deployment status and existing deployments
    if (url.pathname === "/api/deployments" && req.method === "GET") {
      return Response.json({
        lastDeployment: DeploymentManager.getStatus(),
        existingDeployments: DataManager.listDataFiles("deployments"),
        products: DataManager.listProducts(),
        users: DataManager.listUsers(),
        proxies: DataManager.listDataFiles("proxies"),
      }, { headers: corsHeaders });
    }

    // List products
    if (url.pathname === "/api/products" && req.method === "GET") {
      return Response.json(DataManager.listProducts(), { headers: corsHeaders });
    }

    // List users
    if (url.pathname === "/api/users" && req.method === "GET") {
      return Response.json(DataManager.listUsers(), { headers: corsHeaders });
    }

    // List KVM data
    if (url.pathname === "/api/kvm" && req.method === "GET") {
      const { globalKvmStore } = await import("./lib/policies/KeyValueMapOperations");
      return Response.json(globalKvmStore, { headers: corsHeaders });
    }

    // Traces API
    if (url.pathname === "/api/traces" && req.method === "GET") {
      return Response.json(TraceManager.getRecentTraces(), { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/traces/") && req.method === "GET") {
      const traceId = url.pathname.replace(/^\\/api\\/traces\\//, "");
      const format = url.searchParams.get("format");
      if (format === "apigee") {
        const apigeeTrace = TraceManager.getApigeeTrace(traceId);
        if (!apigeeTrace) return Response.json({ error: "Trace not found" }, { status: 404, headers: corsHeaders });
        return Response.json(apigeeTrace, { headers: corsHeaders });
      }
      if (format === "otel") {
        const otelTrace = TraceManager.getOtelTrace(traceId);
        if (!otelTrace) return Response.json({ error: "Trace not found" }, { status: 404, headers: corsHeaders });
        return Response.json(otelTrace, { headers: corsHeaders });
      }
      const rawTrace = TraceManager.getTrace(traceId);
      if (!rawTrace) return Response.json({ error: "Trace not found" }, { status: 404, headers: corsHeaders });
      return Response.json(rawTrace, { headers: corsHeaders });
    }

    if ((url.pathname === "/api/traces" || url.pathname === "/api/traces/clear") && (req.method === "DELETE" || req.method === "POST")) {
      TraceManager.clear();
      return Response.json({ success: true, message: "Traces cleared" }, { headers: corsHeaders });
    }

    // List deployment tests
    if (url.pathname === "/api/tests" && req.method === "GET") {
      return Response.json(DataManager.listTests(), { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/tests/") && req.method === "GET") {
      const proxyName = url.pathname.replace(/^\\/api\\/tests\\//, "");
      return Response.json(DataManager.getTestsForProxy(proxyName), { headers: corsHeaders });
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

    // Create a new template or deployment
    if ((url.pathname === "/api/templates" || url.pathname.startsWith("/api/templates/")) && req.method === "POST") {
      try {
        const pathId = url.pathname.startsWith("/api/templates/") ? url.pathname.split("/").pop() : undefined;
        const rawText = await req.text();
        const parsed = await parseTemplateRequestBody(rawText, req.headers.get("content-type") || "");

        if (parsed.isDeployment) {
          const result = await DeploymentManager.deploy(parsed.content, { build: false });
          return Response.json(result, { headers: corsHeaders });
        }

        const name = pathId || url.searchParams.get("name") || url.searchParams.get("id") || parsed.name;
        if (!name) {
          return Response.json({ success: false, error: "Missing template name in URL, query parameters, or YAML/JSON body" }, { status: 400, headers: corsHeaders });
        }
        TemplateManager.createOrUpdate(name, parsed.content);
        if (url.searchParams.get("deploy") !== "false") {
          await runBuild({ deferWrites: 50 });
        }
        return Response.json({ success: true, name, deployed: true }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Update specific template
    if ((url.pathname === "/api/templates" || url.pathname.startsWith("/api/templates/")) && req.method === "PUT") {
      try {
        const pathId = url.pathname.startsWith("/api/templates/") ? url.pathname.split("/").pop() : undefined;
        const rawText = await req.text();
        const parsed = await parseTemplateRequestBody(rawText, req.headers.get("content-type") || "");

        if (parsed.isDeployment) {
          const result = await DeploymentManager.deploy(parsed.content, { build: false });
          return Response.json(result, { headers: corsHeaders });
        }

        const name = pathId || url.searchParams.get("name") || url.searchParams.get("id") || parsed.name;
        if (!name) {
          return Response.json({ success: false, error: "Missing template name in URL, query parameters, or YAML/JSON body" }, { status: 400, headers: corsHeaders });
        }
        TemplateManager.createOrUpdate(name, parsed.content);
        if (url.searchParams.get("deploy") !== "false") {
          await runBuild({ deferWrites: 50 });
        }
        return Response.json({ success: true, name, deployed: true }, { headers: corsHeaders });
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
      await runBuild({ deferWrites: 50 });
      return Response.json({ success: true }, { headers: corsHeaders });
    }

    let filePath = "./public" + url.pathname;
    if (url.pathname === "/") filePath = "./public/index.html";

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, { headers: corsHeaders });
    }

    if (req.headers.get("accept")?.includes("text/html")) {
      const indexFile = Bun.file("./public/index.html");
      if (await indexFile.exists()) {
        return new Response(indexFile, { headers: { ...corsHeaders, "Content-Type": "text/html;charset=utf-8" } });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
  });
}

let server;
try {
  server = startBungeeServer(requestedPort);
} catch (err: any) {
  if (err?.code === "EADDRINUSE" && !process.env.PORT) {
    console.warn(\`Port \${requestedPort} is in use, falling back to port 8088\`);
    server = startBungeeServer(8088);
  } else {
    throw err;
  }
}

console.log(\`Listening on \${server.url}\`);
`;

  // 4. Update index.ts (only write if changed to avoid unnecessary watcher restarts)
  const existingContent = fs.existsSync(INDEX_FILE) ? fs.readFileSync(INDEX_FILE, "utf8") : "";
  if (existingContent !== indexContent) {
    pendingWrites.push({ path: INDEX_FILE, content: indexContent });
  }

  // Clean up any stale proxy .ts/.js files in PROXIES_DIR that were not generated in this build
  const staleFiles: string[] = [];
  if (fs.existsSync(PROXIES_DIR)) {
    for (const file of fs.readdirSync(PROXIES_DIR)) {
      if ((file.endsWith(".ts") || file.endsWith(".js")) && !generatedFiles.has(file)) {
        staleFiles.push(path.join(PROXIES_DIR, file));
      }
    }
  }

  const commitWrites = () => {
    for (const pw of pendingWrites) {
      try {
        const existing = fs.existsSync(pw.path) ? fs.readFileSync(pw.path, "utf8") : null;
        if (existing !== pw.content) {
          fs.writeFileSync(pw.path, pw.content);
        }
      } catch (e) {
        console.error("Error writing", pw.path, e);
      }
    }
    for (const sf of staleFiles) {
      try {
        fs.unlinkSync(sf);
      } catch {}
    }
  };

  if (options?.deferWrites && options.deferWrites > 0) {
    setTimeout(commitWrites, options.deferWrites);
  } else {
    commitWrites();
  }

  return { success: true, count: compiledProxies.length, proxies: compiledProxies };
}

if (import.meta.main) {
  runBuild()
    .then((res) => console.log(`Build complete! Compiled ${res.count} proxies.`))
    .catch((err) => {
      console.error("Build failed:", err);
      process.exit(1);
    });
}
