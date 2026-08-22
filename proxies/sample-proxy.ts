import { Apigee, ApigeeContext, ApigeeRequest, ApigeeResponse } from "../lib/apigee";
import { Http } from "../lib/http";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
};

export class SampleProxyProxy {
  async handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const context = new ApigeeContext(req);

    try {
      // 2. Execute Target Connection
      const path = Http.getPath(req.url, "/sample");
      const targetBaseUrl = "https://mocktarget.apigee.net";
      const fullTargetUrl = path ? `${targetBaseUrl}/${path}` : targetBaseUrl;

      const reqHeaders: Record<string, string> = {
        ...context.request.headers,
      };
      if (req.headers.get("authorization")) {
        reqHeaders["authorization"] = req.headers.get("authorization")!;
      }

      const response = await fetch(fullTargetUrl, {
        method: req.method,
        headers: reqHeaders,
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
      context.response.content = await response.text();

      // 3. Run Response Flow Policies
      await Apigee.assignMessage({}, context);

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

export const sample_proxyInstance = new SampleProxyProxy();

export async function sample_proxyProxy(req: Request): Promise<Response> {
  return sample_proxyInstance.handle(req);
}
