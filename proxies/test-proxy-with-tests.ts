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

const print = console.log;

// Always initialize DataManager to load YAMLs (deployments, products, kvm, users) on startup
DataManager.initializeSync();


export class TestProxyWithTestsProxy {
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

    const context = new ApigeeContext(req, {}, "test-proxy-with-tests");

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
      context.finalizeTrace();
      const responseHeaders = {
        ...corsHeaders,
        ...context.response.headers,
      };
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

export const test_proxy_with_testsInstance = new TestProxyWithTestsProxy();

export async function test_proxy_with_testsProxy(req: Request): Promise<Response> {
  return test_proxy_with_testsInstance.handle(req);
}
