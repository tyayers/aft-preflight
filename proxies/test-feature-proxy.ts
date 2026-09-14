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


export class TestFeatureProxyProxy {
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

export const test_feature_proxyInstance = new TestFeatureProxyProxy();

export async function test_feature_proxyProxy(req: Request): Promise<Response> {
  return test_feature_proxyInstance.handle(req);
}
