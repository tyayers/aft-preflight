import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { TemplateManager } from "./lib/TemplateManager";
import { google_aiplatform_targetProxy } from "./proxies/google-aiplatform-target";
import { testlocalProxy } from "./proxies/testlocal";
import { sample_proxyProxy } from "./proxies/sample-proxy";
import { proxy_example_1Proxy } from "./proxies/proxy-example-1";

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
    "/v1/projects/*": google_aiplatform_targetProxy,
    "/v1/projects": google_aiplatform_targetProxy,
    "/v1/chat/completions/*": testlocalProxy,
    "/v1/chat/completions": testlocalProxy,
    "/sample/*": sample_proxyProxy,
    "/sample": sample_proxyProxy,
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

console.log(`Listening on ${server.url}`);
