import {
  Apigee,
  ApigeeContext,
  ApigeeRequest,
  ApigeeResponse,
  globalResourceStore,
} from "../lib/apigee";
import { Http } from "../lib/http";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
};

const print = console.log;


export class TestOrgImportedProxyProxy {
  async handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const context = new ApigeeContext(req);

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
      const path = Http.getPath(req.url, "/org-imported");
      const routes = [
        {
          "name": "default",
          "target": "default"
        }
      ];
      const targetsMap: Record<string, any> = {
        "default": {
          "name": "default",
          "url": "https://httpbin.org/json"
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

      const targetObj = targetsMap[selectedTargetName];
      const rawTargetUrl = targetObj?.url || "https://httpbin.org/json";
      const resolvedTargetBaseUrl = context.resolveVariables(rawTargetUrl).replace(/\/+$/, "");
      const fullTargetUrl = path ? `${resolvedTargetBaseUrl}/${path}` : resolvedTargetBaseUrl;

      const headers = new Headers();
      const skipHeaders = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade"]);
      for (const [k, v] of Object.entries(context.request.headers)) {
        if (!skipHeaders.has(k.toLowerCase()) && v !== undefined && v !== null) {
          headers.set(k, v);
        }
      }

      let response: Response;
      try {
        response = await fetch(fullTargetUrl, {
          method: req.method,
          headers,
          body: req.method !== "GET" && req.method !== "HEAD" ? context.request.rawContent : undefined,
          tls: { rejectUnauthorized: false } as any,
        });

        context.response.status = response.status;
        context.response.statusText = response.statusText;
        for (const [k, v] of response.headers.entries()) {
          if (k.toLowerCase() !== "content-length") {
            context.response.setHeader(k, v);
          }
        }
      } catch (targetErr: any) {
        context.setVariable("target.failed", true);
        context.setVariable("target.error", targetErr.message);
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
                yield context.response.rawContent;
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
      const responseHeaders = {
        ...corsHeaders,
        ...context.response.headers,
      };
      return new Response(context.response.rawContent, {
        status: context.response.status,
        headers: responseHeaders,
      });
    } catch (err: any) {
      const responseHeaders = {
        ...corsHeaders,
        ...context.response.headers,
      };
      return new Response(context.response.rawContent || JSON.stringify({ error: err.message }), {
        status: context.fault?.status || context.response.status || 500,
        headers: responseHeaders,
      });
    }
  }
}

export const test_org_imported_proxyInstance = new TestOrgImportedProxyProxy();

export async function test_org_imported_proxyProxy(req: Request): Promise<Response> {
  return test_org_imported_proxyInstance.handle(req);
}
