import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const PROXIES_DIR = "./proxies";
const TEMPLATES_DIR = "./templates";
const INDEX_FILE = "./index.ts";

// 1. Cleanup proxies directory
if (fs.existsSync(PROXIES_DIR)) {
  fs.readdirSync(PROXIES_DIR).forEach((file) => {
    fs.unlinkSync(path.join(PROXIES_DIR, file));
  });
} else {
  fs.mkdirSync(PROXIES_DIR);
}

// 2. Prepare to rebuild index.ts
let indexImports = "";
let indexRoutes = "";

// 3. Process each yaml file in templates
const templates = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((f) => f.endsWith(".yaml"));

for (const templateFile of templates) {
  const content = fs.readFileSync(
    path.join(TEMPLATES_DIR, templateFile),
    "utf8",
  );
  const data = yaml.load(content) as any;

  if (!data || !data.endpoints) continue;

  for (const endpoint of data.endpoints) {
    const basePath = endpoint.basePath;
    const targetName = endpoint.routes?.[0]?.target;
    const target = data.targets?.find((t: any) => t.name === targetName);
    const targetUrl = target?.url;

    if (!targetUrl) continue;

    const sanitizedName = endpoint.name.replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `${sanitizedName}.ts`;
    const functionName = `${sanitizedName}Proxy`;

    // Collect all policy steps for this endpoint/target chain
    const requestSteps: string[] = [];
    const responseSteps: string[] = [];

    const processFlows = (flows: any[]) => {
      if (!flows) return;
      for (const flow of flows) {
        if (flow.mode === "Request") {
          flow.steps?.forEach((s: any) => requestSteps.push(s.name));
        } else if (flow.mode === "Response") {
          flow.steps?.forEach((s: any) => responseSteps.push(s.name));
        }
      }
    };

    processFlows(endpoint.flows);
    processFlows(target?.flows);

    // Generate policy sub-functions
    let policyFunctions = "";
    const uniquePolicyNames = Array.from(
      new Set([...requestSteps, ...responseSteps]),
    );

    for (const policyName of uniquePolicyNames) {
      const policy = data.policies?.find((p: any) => p.name === policyName);
      if (!policy) continue;

      let policyCode = "";
      if (policy.type === "Javascript") {
        const js = policy.content.javascript;
        if (js.source) {
          policyCode = js.source;
        } else if (js.resourceUrl) {
          const resourceName = js.resourceUrl.replace("jsc://", "");
          const resource = data.resources?.find(
            (r: any) => r.name === resourceName,
          );
          policyCode = resource?.content || "";
        }
      }

      const policyFunctionName = `policy_${policyName.replace(/[^a-zA-Z0-9]/g, "_")}`;
      policyFunctions += `
function ${policyFunctionName}(request: any, response: any, context: any) {
  const print = console.log;
  ${policyCode}
}
`;
    }

    // Helper to map policy names to function calls
    const generatePolicyCalls = (stepNames: string[]) => {
      return stepNames
        .map(
          (name) =>
            `  policy_${name.replace(/[^a-zA-Z0-9]/g, "_")}(proxyRequest, proxyResponse, context);`,
        )
        .join("\n");
    };

    const requestPolicyCalls = generatePolicyCalls(requestSteps);
    const responsePolicyCalls = generatePolicyCalls(responseSteps);

    // Generate proxy handler file content
    const proxyContent = `import { Http } from "../utilities/http";

${policyFunctions}

export async function ${functionName}(req: Request): Promise<Response> {
  const path = Http.getPath(req.url);
  const url = new URL(req.url);

  const proxyRequest = {
    content: "", // Request body if needed
    headers: Object.fromEntries(req.headers.entries()),
  };
  const proxyResponse = {
    content: "",
    status: 200,
  };

  // Initialize context with some basic variables
  const context = {
    variables: {} as Record<string, any>,
    getVariable(name: string) {
      if (name === "response.content") return proxyResponse.content;
      if (name.startsWith("request.queryparam.")) {
        return url.searchParams.get(name.split(".").pop()!);
      }
      return this.variables[name];
    },
    setVariable(name: string, value: any) {
      if (name === "response.content") {
        proxyResponse.content = value;
      } else {
        this.variables[name] = value;
      }
    }
  };

  // Populate propertyset from resources if available
  ${(data.resources || [])
    .filter((r: any) => r.type === "properties")
    .map((r: any) => {
      const propLines = r.content
        .split("\n")
        .filter((l: string) => l.includes("="));
      const prefix = r.name.replace(".properties", "").replace(/-/g, ".");
      return propLines
        .map((l: string) => {
          const [k, v] = l.split("=");
          return `context.setVariable("propertyset.${prefix}.${k ? k.trim() : ""}", "${v ? v.trim() : ""}");`;
        })
        .join("\n  ");
    })
    .join("\n  ")}

  // 1. Run Request Policies
${requestPolicyCalls}

  const response = await fetch(
    "${targetUrl}" + "/" + path,
    {
      method: req.method,
      headers: {
        Authorization: req.headers.get("authorization") ?? "",
      },
      body: req.body,
    },
  );

  let newResponse = new Response(
    async function* () {
      if (response && response.body) {
        for await (const chunk of response.body) {
          let chunkString = Buffer.from(chunk).toString("utf-8");

          // 2. Run Response Policies on each chunk
          proxyResponse.content = chunkString;
          proxyResponse.status = response.status;

${responsePolicyCalls}

          yield proxyResponse.content;
        }
      }
    },
    { status: response.status },
  );

  return newResponse;
}
`;

    fs.writeFileSync(path.join(PROXIES_DIR, fileName), proxyContent);

    // Add to index info
    indexImports += `import { ${functionName} } from "./proxies/${sanitizedName}";\n`;
    indexRoutes += `    "${basePath}/*": ${functionName},\n`;
  }
}

// 4. Update index.ts
const indexContent = `import { spawn } from "node:child_process";
import { TemplateManager } from "./utilities/TemplateManager";
${indexImports}
const server = Bun.serve({
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
  routes: {
${indexRoutes}  },
  async fetch(req) {
    const url = new URL(req.url);
    
    // Add rebuild endpoint
    if (url.pathname === "/rebuild" && req.method === "POST") {
      console.log("Rebuild requested. Running build.ts...");
      try {
        const proc = Bun.spawn(["bun", "run", "build.ts"]);
        const exitCode = await proc.exited;
        
        if (exitCode !== 0) {
          const errorOutput = await new Response(proc.stderr).text();
          console.error("Build failed:", errorOutput);
          return Response.json({ success: false, error: errorOutput }, { status: 500 });
        }

        console.log("Build complete! Restarting service...");
        
        // Stop the server to free up the port
        server.stop();
        
        // Spawn a detached process running the same service
        const child = spawn(process.argv[0], process.argv.slice(1), {
          detached: true,
          stdio: "inherit",
        });
        child.unref();

        // Exit the current process after a short delay
        setTimeout(() => {
          console.log("Old process exiting...");
          process.exit(0);
        }, 100);

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
        const body = await req.json() as any;
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
        const body = await req.json() as any;
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
  }
});

console.log(\`Listening on \${server.url}\`);
`;

fs.writeFileSync(INDEX_FILE, indexContent);

console.log("Build complete!");
