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
const templates = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".yaml"));

for (const templateFile of templates) {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, templateFile), "utf8");
  const data = yaml.load(content) as any;

  if (!data || !data.endpoints) continue;

  for (const endpoint of data.endpoints) {
    const basePath = endpoint.basePath;
    const targetName = endpoint.routes?.[0]?.target;
    const target = data.targets?.find((t: any) => t.name === targetName);
    const targetUrl = target?.url;

    if (!targetUrl) continue;

    // Use endpoint name for the proxy function and file
    const sanitizedName = endpoint.name.replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `${sanitizedName}.ts`;
    const functionName = `${sanitizedName}Proxy`;

    // Generate proxy handler file content based on the pattern in proxies/llm.ts
    const proxyContent = `import { Http } from "../utilities/http";

export async function ${functionName}(req: Request): Promise<Response> {
  const path = Http.getPath(req.url);

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
          console.log("Chunk received: " + chunkString);
          yield chunkString;
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
const indexContent = `${indexImports}
const server = Bun.serve({
  port: 8080,
  routes: {
${indexRoutes}  },
});

console.log(\`Listening on \${server.url}\`);
`;

fs.writeFileSync(INDEX_FILE, indexContent);

console.log("Build complete!");
