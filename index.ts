import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { TemplateManager } from "./lib/TemplateManager";
import { DataManager } from "./lib/DataManager";
import { DeploymentManager } from "./lib/DeploymentManager";
import { runBuild } from "./build";
import { test_full_deployment_apiProxy } from "./proxies/test-full-deployment-api";
import { google_aiplatform_targetProxy } from "./proxies/google-aiplatform-target";
import { test_org_imported_proxyProxy } from "./proxies/test-org-imported-proxy";
import { test_converted_basic_apiProxy } from "./proxies/test-converted-basic-api";
import { testlocalProxy } from "./proxies/testlocal";
import { sample_proxyProxy } from "./proxies/sample-proxy";
import { test_feature_proxyProxy } from "./proxies/test-feature-proxy";
import { proxy_example_1Proxy } from "./proxies/proxy-example-1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
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

const server = Bun.serve({
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
  routes: {
    "/ecommerce/v1/*": test_full_deployment_apiProxy,
    "/ecommerce/v1": test_full_deployment_apiProxy,
    "/v1/projects/*": google_aiplatform_targetProxy,
    "/v1/projects": google_aiplatform_targetProxy,
    "/org-imported/*": test_org_imported_proxyProxy,
    "/org-imported": test_org_imported_proxyProxy,
    "/converted-basic/*": test_converted_basic_apiProxy,
    "/converted-basic": test_converted_basic_apiProxy,
    "/v1/chat/completions/*": testlocalProxy,
    "/v1/chat/completions": testlocalProxy,
    "/sample/*": sample_proxyProxy,
    "/sample": sample_proxyProxy,
    "/test-feature-proxy/*": test_feature_proxyProxy,
    "/test-feature-proxy": test_feature_proxyProxy,
    "/proxy-example/*": proxy_example_1Proxy,
    "/proxy-example": proxy_example_1Proxy,
  },
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
        const buildRes = await runBuild();
        return Response.json({ success: true, message: "Build successful. Service restarted!", ...buildRes }, { headers: corsHeaders });
      } catch (err: any) {
        console.error("Rebuild error:", err);
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Deployments endpoint (POST deployment YAML or JSON)
    if ((url.pathname === "/api/deployments" || url.pathname === "/api/deployment" || url.pathname === "/deploy") && req.method === "POST") {
      try {
        const rawText = await req.text();
        const result = await DeploymentManager.deploy(rawText);
        return Response.json(result, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err: any) {
        console.error("Deployment error:", err);
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    // List deployment status
    if (url.pathname === "/api/deployments" && req.method === "GET") {
      return Response.json({
        lastDeployment: DeploymentManager.getStatus(),
        products: DataManager.listProducts(),
        users: DataManager.listUsers(),
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
          const result = await DeploymentManager.deploy(parsed.content);
          return Response.json(result, { headers: corsHeaders });
        }

        const name = pathId || url.searchParams.get("name") || url.searchParams.get("id") || parsed.name;
        if (!name) {
          return Response.json({ success: false, error: "Missing template name in URL, query parameters, or YAML/JSON body" }, { status: 400, headers: corsHeaders });
        }
        TemplateManager.createOrUpdate(name, parsed.content);
        if (url.searchParams.get("deploy") !== "false") {
          await runBuild();
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
          const result = await DeploymentManager.deploy(parsed.content);
          return Response.json(result, { headers: corsHeaders });
        }

        const name = pathId || url.searchParams.get("name") || url.searchParams.get("id") || parsed.name;
        if (!name) {
          return Response.json({ success: false, error: "Missing template name in URL, query parameters, or YAML/JSON body" }, { status: 400, headers: corsHeaders });
        }
        TemplateManager.createOrUpdate(name, parsed.content);
        if (url.searchParams.get("deploy") !== "false") {
          await runBuild();
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
      await runBuild();
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

console.log(`Listening on ${server.url}`);
