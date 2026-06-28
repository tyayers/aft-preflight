import { Http } from "../utilities/http";


function policy_helloworld_JS_AddHelloWorld(request: any, response: any, context: any) {
  const print = console.log;
  var responseText = response.content;
if (!responseText) responseText = "";

var responseObject = undefined;

try {
  responseObject = JSON.parse(responseText);
} catch(e) {
  print("Could not parse JSON.");
}

var message = context.getVariable("request.queryparam.message");
if (!message)
  message = context.getVariable("propertyset.helloworld-helloworld.MESSAGE");
if (!message)
  message = "Hello world 11!";

if (responseObject) {
  responseObject["message"] = message;
  context.setVariable("response.content", JSON.stringify(responseObject));
} else {
  responseText = responseText + " " + message;
  context.setVariable("response.content", responseText);
}
}


export async function remote_serviceProxy(req: Request): Promise<Response> {
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
  context.setVariable("propertyset.helloworld.helloworld.MESSAGE", "Hello world!");

  // 1. Run Request Policies


  const response = await fetch(
    "https://boomerang-service-323709580283.europe-west1.run.app" + "/" + path,
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
        policy_helloworld_JS_AddHelloWorld(proxyRequest, proxyResponse, context);
      let newResponse = new Response(proxyResponse.content);
      return newResponse;

  return newResponse;
}
