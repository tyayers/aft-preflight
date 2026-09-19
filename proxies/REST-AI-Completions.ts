import {
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


export class RESTAICompletionsProxy {
  constructor() {
    DataManager.initializeSync();
  }

  async handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const context = new ApigeeContext(req, {}, "REST-AI-Completions");

    if (req.method !== "GET" && req.method !== "HEAD") {
      const contentType = req.headers.get("content-type") || "";
      if (Http.isText(contentType)) {
        context.request.content = await req.text();
      } else {
        context.request.content = new Uint8Array(await req.arrayBuffer());
      }
    }

    try {
      // 2. Select and Execute Target Connection
      const path = Http.getPath(req.url, "/v1/ai/completions");
      const routes = [
        {
          "name": "default",
          "target": "default"
        }
      ];
      const targetsMap: Record<string, any> = {
        "default": {
          "name": "default",
          "url": "https://generativelanguage.googleapis.com"
        }
      };

      let selectedTargetName = "default";
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
        targetObj = targetsMap["default"] || Object.values(targetsMap)[0];
      }
      const rawTargetUrl = targetObj?.url || "https://generativelanguage.googleapis.com";
      const resolvedTargetBaseUrl = context.resolveVariables(rawTargetUrl).replace(/\/+$/, "");
      const fullTargetUrl = path ? `${resolvedTargetBaseUrl}/${path}` : resolvedTargetBaseUrl;
      if (!fullTargetUrl || !fullTargetUrl.trim()) {
        throw new Error(`Target '${selectedTargetName}' not found or has no URL defined in proxy/template.`);
      }

      const headers = new Headers();
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
        if (!context.response.content && context.response.status === 200) {
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
                  const yielded = context.response.rawContent !== undefined && context.response.rawContent !== null
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

      // 4. Return Response
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
      context.finalizeTrace();
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

export const REST_AI_CompletionsInstance = new RESTAICompletionsProxy();

export async function REST_AI_CompletionsProxy(req: Request): Promise<Response> {
  return REST_AI_CompletionsInstance.handle(req);
}
