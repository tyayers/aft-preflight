import { spawn } from "node:child_process";
import { TemplateManager } from "./utilities/TemplateManager";
import { apigee_mockProxy } from "./proxies/apigee_mock";
import { local_serviceProxy } from "./proxies/local_service";
import { llmProxy } from "./proxies/llm";
import { remote_serviceProxy } from "./proxies/remote_service";

const server = Bun.serve({
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
  routes: {
    "/apigeemock/*": apigee_mockProxy,
    "/local-service/*": local_serviceProxy,
    "/llm/*": llmProxy,
    "/remote-service/*": remote_serviceProxy,
  },
  async fetch(req) {
    const url = new URL(req.url);

    // Add rebuild endpoint
    if (url.pathname === "/rebuild" && req.method === "POST") {
      console.log("Rebuild requested. Running build.ts...");
      try {
        const proc = Bun.spawn(["./bun", "run", "build.ts"]);

        return Response.json({ success: true, message: "Build successful. Service restarted!" });
      } catch (err: any) {
        console.error("Rebuild error:", err);
        return Response.json({ success: false, error: err.message }, { status: 500 });
      }
    }

    // List templates
    if (url.pathname === "/api/templates" && req.method === "GET") {
      return Response.json(TemplateManager.list());
    }

    // Get specific template
    if (url.pathname.startsWith("/api/templates/") && req.method === "GET") {
      const id = url.pathname.split("/").pop()!;
      const content = TemplateManager.get(id);
      if (content === null) {
        return new Response("Template Not Found", { status: 404 });
      }
      return new Response(content, { headers: { "Content-Type": "text/yaml" } });
    }

    // Create a new template or update
    if (url.pathname === "/api/templates" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        if (!body.id || !body.content) {
          return Response.json({ success: false, error: "Missing id or content" }, { status: 400 });
        }
        TemplateManager.createOrUpdate(body.id, body.content);
        return Response.json({ success: true });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500 });
      }
    }

    // Update specific template
    if (url.pathname.startsWith("/api/templates/") && req.method === "PUT") {
      try {
        const id = url.pathname.split("/").pop()!;
        const body = (await req.json()) as any;
        if (!body.content) {
          return Response.json({ success: false, error: "Missing content" }, { status: 400 });
        }
        TemplateManager.createOrUpdate(id, body.content);
        return Response.json({ success: true });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500 });
      }
    }

    // Delete specific template
    if (url.pathname.startsWith("/api/templates/") && req.method === "DELETE") {
      const id = url.pathname.split("/").pop()!;
      const deleted = TemplateManager.delete(id);
      if (!deleted) {
        return Response.json({ success: false, error: "Template not found" }, { status: 404 });
      }
      return Response.json({ success: true });
    }

    let filePath = "./public" + url.pathname;
    if (url.pathname === "/") filePath = "./public/index.html";

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(Bun.argv);
console.log(`Listening on ${server.url}`);
