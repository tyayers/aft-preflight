import { Http } from "../utilities/http";



export async function llmProxy(req: Request): Promise<Response> {
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
  

  // 1. Run Request Policies


  const response = await fetch(
    "https://aiplatform.googleapis.com" + "/" + path,
    {
      method: req.method,
      headers: {
        Authorization: req.headers.get("authorization") ?? "",
      },
      body: req.body,
    },
  );

    proxyResponse.content = await response.text();
      proxyResponse.status = response.status;
      
      let newResponse = new Response(proxyResponse.content);
      return newResponse;

  return newResponse;
}
