import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { TemplateManager } from "./lib/TemplateManager";
import { DataManager } from "./lib/DataManager";
import { DeploymentManager } from "./lib/DeploymentManager";
import { TraceManager } from "./lib/tracer";
import { runBuild } from "./build";
import { test_converted_basic_apiProxy } from "./proxies/test-converted-basic-api";
import { testlocalProxy } from "./proxies/testlocal";
import { test_proxy_with_testsProxy } from "./proxies/test-proxy-with-tests";
import { sample_proxyProxy } from "./proxies/sample-proxy";
import { test_feature_proxyProxy } from "./proxies/test-feature-proxy";
import { REST_AI_CompletionsProxy } from "./proxies/REST-AI-Completions";
import { test_runtime_proxyProxy } from "./proxies/test-runtime-proxy";

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
    "/converted-basic/*": test_converted_basic_apiProxy,
    "/converted-basic": test_converted_basic_apiProxy,
    "/v1/chat/completions/*": testlocalProxy,
    "/v1/chat/completions": testlocalProxy,
    "/v1/test-target/*": test_proxy_with_testsProxy,
    "/v1/test-target": test_proxy_with_testsProxy,
    "/sample/*": sample_proxyProxy,
    "/sample": sample_proxyProxy,
    "/test-feature-proxy/*": test_feature_proxyProxy,
    "/test-feature-proxy": test_feature_proxyProxy,
    "/v1/chat/completions/*": REST_AI_CompletionsProxy,
    "/v1/chat/completions": REST_AI_CompletionsProxy,
    "/test-runtime-endpoint/*": test_runtime_proxyProxy,
    "/test-runtime-endpoint": test_runtime_proxyProxy,
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
      const traceId = url.pathname.replace(/^\/api\/traces\//, "");
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
      const proxyName = url.pathname.replace(/^\/api\/tests\//, "");
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
    console.warn(`Port ${requestedPort} is in use, falling back to port 8088`);
    server = startBungeeServer(8088);
  } else {
    throw err;
  }
}

console.log(`Listening on ${server.url}`);
